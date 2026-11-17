import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type { IdentityProvider, Prisma, Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { idpSecrets } from './idp-secrets.js';
import { supportedIdpProviderType } from './idp-provider-types.js';
import {
  SAML_UNUSED_OAUTH_COLUMNS,
  isSamlEndpointUrl,
  validateSamlConfig,
  type SamlIdpConfig,
} from './saml-config.js';
import {
  IdpMetadataError,
  MAX_METADATA_SIZE,
  parseIdpMetadata,
  spEndpoints,
  type IdpMetadataFields,
  type SpEndpoints,
} from '../broker/saml/saml-sp-messages.js';
import {
  ResponseTooLargeError,
  SsrfBlockedError,
  safeGet,
} from '../common/security/safe-http-client.js';
import type { CreateIdentityProviderDto } from './dto/create-identity-provider.dto.js';
import type { UpdateIdentityProviderDto } from './dto/update-identity-provider.dto.js';

const OAUTH_REQUIRED = [
  'clientId',
  'clientSecret',
  'authorizationUrl',
  'tokenUrl',
] as const;

@Injectable()
export class IdentityProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** A `samlConfig` checked and normalized, or a 400 with every problem. */
  private samlConfig(value: unknown): SamlIdpConfig {
    const result = validateSamlConfig(value);
    if (!result.ok) throw new BadRequestException(result.errors);
    return result.config;
  }

  /** The SP endpoints an admin registers at the IdP for a `saml` provider. */
  spEndpointsOf(realm: Realm, alias: string): SpEndpoints {
    return spEndpoints(
      process.env['BASE_URL'] ?? 'http://localhost:3000',
      realm.name,
      alias,
    );
  }

  /** A provider row as the admin API shows it (SP endpoints for SAML). */
  withSpEndpoints<T extends Pick<IdentityProvider, 'alias' | 'providerType'>>(
    realm: Realm,
    idp: T,
  ): T & { samlSp?: SpEndpoints } {
    return idp.providerType === 'saml'
      ? { ...idp, samlSp: this.spEndpointsOf(realm, idp.alias) }
      : idp;
  }

  async create(realm: Realm, dto: CreateIdentityProviderDto) {
    const providerType = supportedIdpProviderType(dto.providerType) ?? 'oidc';
    const existing = await this.prisma.identityProvider.findUnique({
      where: { realmId_alias: { realmId: realm.id, alias: dto.alias } },
    });
    if (existing) {
      throw new ConflictException(
        `Identity provider '${dto.alias}' already exists`,
      );
    }

    if (providerType === 'saml') {
      const samlConfig = this.samlConfig(dto.samlConfig);
      return this.prisma.identityProvider.create({
        data: {
          realmId: realm.id,
          alias: dto.alias,
          displayName: dto.displayName,
          enabled: dto.enabled ?? true,
          providerType,
          // The OAuth columns stay empty; the broker never reads them here.
          ...SAML_UNUSED_OAUTH_COLUMNS,
          clientSecret: idpSecrets.forCreate(this.crypto, ''),
          samlConfig: samlConfig as unknown as Prisma.InputJsonValue,
          trustEmail: dto.trustEmail ?? false,
          linkOnly: dto.linkOnly ?? false,
          syncUserProfile: dto.syncUserProfile ?? true,
        },
      });
    }
    if (dto.samlConfig !== undefined) {
      throw new BadRequestException(
        "samlConfig applies to providerType 'saml' only",
      );
    }

    return this.prisma.identityProvider.create({
      data: {
        realmId: realm.id,
        alias: dto.alias,
        displayName: dto.displayName,
        enabled: dto.enabled ?? true,
        providerType,
        clientId: dto.clientId,
        clientSecret: idpSecrets.forCreate(this.crypto, dto.clientSecret),
        authorizationUrl: dto.authorizationUrl,
        tokenUrl: dto.tokenUrl,
        userinfoUrl: dto.userinfoUrl,
        jwksUrl: dto.jwksUrl,
        issuer: dto.issuer,
        defaultScopes: dto.defaultScopes ?? 'openid email profile',
        trustEmail: dto.trustEmail ?? false,
        linkOnly: dto.linkOnly ?? false,
        syncUserProfile: dto.syncUserProfile ?? true,
      },
    });
  }

  async findAll(realm: Realm) {
    return this.prisma.identityProvider.findMany({
      where: { realmId: realm.id },
      select: {
        id: true,
        alias: true,
        displayName: true,
        enabled: true,
        providerType: true,
        authorizationUrl: true,
        tokenUrl: true,
        defaultScopes: true,
        trustEmail: true,
        linkOnly: true,
        syncUserProfile: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /** The stored row, client secret still encrypted (see idpSecrets). */
  async findByAlias(realm: Realm, alias: string) {
    const idp = await this.prisma.identityProvider.findUnique({
      where: { realmId_alias: { realmId: realm.id, alias } },
    });
    if (!idp) {
      throw new NotFoundException(`Identity provider '${alias}' not found`);
    }
    return idp;
  }

  async update(realm: Realm, alias: string, dto: UpdateIdentityProviderDto) {
    const current = await this.findByAlias(realm, alias);
    const providerType =
      dto.providerType !== undefined
        ? (supportedIdpProviderType(dto.providerType) ?? 'oidc')
        : current.providerType;
    const { samlConfig: samlInput, ...rest } = dto;

    if (providerType === 'saml') {
      // A provider switched to SAML must bring a full config; one already
      // SAML keeps its config unless a new one is sent.
      const samlConfig =
        samlInput !== undefined || current.providerType !== 'saml'
          ? this.samlConfig(samlInput)
          : undefined;
      const oauthSent = (
        ['clientId', 'authorizationUrl', 'tokenUrl'] as const
      ).filter((k) => rest[k]);
      if (oauthSent.length) {
        throw new BadRequestException(
          `${oauthSent.join(', ')} do not apply to a SAML identity provider`,
        );
      }
      return this.prisma.identityProvider.update({
        where: { realmId_alias: { realmId: realm.id, alias } },
        data: {
          displayName: rest.displayName,
          enabled: rest.enabled,
          trustEmail: rest.trustEmail,
          linkOnly: rest.linkOnly,
          syncUserProfile: rest.syncUserProfile,
          providerType,
          ...(current.providerType !== 'saml'
            ? {
                ...SAML_UNUSED_OAUTH_COLUMNS,
                clientSecret: idpSecrets.forCreate(this.crypto, ''),
              }
            : {}),
          ...(samlConfig
            ? { samlConfig: samlConfig as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
    }

    if (samlInput !== undefined) {
      throw new BadRequestException(
        "samlConfig applies to providerType 'saml' only",
      );
    }
    // A provider switched from SAML to OAuth must bring its endpoints.
    if (current.providerType === 'saml') {
      const missing = OAUTH_REQUIRED.filter((k) => !rest[k]);
      if (missing.length) {
        throw new BadRequestException(
          `${missing.join(', ')} required to change a SAML identity provider to ${providerType}`,
        );
      }
    }
    return this.prisma.identityProvider.update({
      where: { realmId_alias: { realmId: realm.id, alias } },
      data: {
        ...rest,
        ...(dto.providerType !== undefined ? { providerType } : {}),
        ...(current.providerType === 'saml'
          ? {
              samlConfig: null as unknown as Prisma.InputJsonValue,
              defaultScopes: rest.defaultScopes ?? 'openid email profile',
            }
          : {}),
        clientSecret: idpSecrets.forUpdate(this.crypto, rest.clientSecret),
      },
    });
  }

  async remove(realm: Realm, alias: string) {
    await this.findByAlias(realm, alias);
    return this.prisma.identityProvider.delete({
      where: { realmId_alias: { realmId: realm.id, alias } },
    });
  }

  /**
   * The IdP settings in SAML metadata, pasted (`xml`) or fetched from `url`
   * over the SSRF-safe client (no private addresses unless the deployment
   * allows them with WEBHOOK_ALLOW_PRIVATE_TARGETS; paste the XML for an
   * IdP on the internal network). Nothing is stored: the admin reviews the
   * fields and saves the provider.
   */
  async readSamlMetadata(input: {
    xml?: string;
    url?: string;
  }): Promise<IdpMetadataFields> {
    let xml = input.xml;
    if (!xml && input.url) {
      if (!isSamlEndpointUrl(input.url)) {
        throw new BadRequestException('The metadata URL must be an https URL');
      }
      let result;
      try {
        result = await safeGet(
          input.url,
          {
            Accept: 'application/samlmetadata+xml, application/xml, text/xml',
          },
          { timeoutMs: 10_000, maxBytes: MAX_METADATA_SIZE },
        );
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          throw new BadRequestException(
            'The metadata URL is not allowed (it is not a public address). Paste the metadata XML instead.',
          );
        }
        if (err instanceof ResponseTooLargeError) {
          throw new BadRequestException('The metadata is too large.');
        }
        throw new BadRequestException('The metadata URL could not be fetched.');
      }
      if (result.statusCode !== 200) {
        throw new BadRequestException(
          `The metadata URL answered with HTTP ${result.statusCode}.`,
        );
      }
      xml = result.body;
    }
    if (!xml) {
      throw new BadRequestException('Send the metadata XML or its URL.');
    }
    try {
      return parseIdpMetadata(xml);
    } catch (err) {
      if (err instanceof IdpMetadataError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
