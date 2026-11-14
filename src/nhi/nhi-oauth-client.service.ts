import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { NhiService } from './nhi.service.js';
import { liveCertificateCredentialFilter } from './nhi-credential-status.js';
import type { NhiOAuthClientDto } from './dto/nhi-oauth-client.dto.js';

const NHI_CLIENT_SELECT = {
  id: true,
  realmId: true,
  clientId: true,
  name: true,
  enabled: true,
  clientType: true,
  grantTypes: true,
  tokenEndpointAuthMethod: true,
  tlsClientCertificateBoundAccessTokens: true,
  nhiIdentityId: true,
  createdAt: true,
  updatedAt: true,
} as const;

type NhiClientRow = Prisma.ClientGetPayload<{
  select: typeof NHI_CLIENT_SELECT;
}>;

type CertificateMethod = 'tls_client_auth' | 'self_signed_tls_client_auth';

const METHOD_OF_MODE = {
  SELF_SIGNED: 'self_signed_tls_client_auth',
  PKI: 'tls_client_auth',
} as const satisfies Record<string, CertificateMethod>;

/**
 * The OAuth client of an NHI identity (RFC 8705 NHI binding). The identity
 * authenticates at the realm's token endpoint as this client, with
 * `client_credentials` and one of its certificate credentials; its tokens
 * are always bound to the certificate (`cnf.x5t#S256`).
 *
 * One client per identity, in the identity's realm. Deleting the identity
 * deletes the client (cascade): a client whose identity is gone could never
 * authenticate, and keeping it would only leave a name behind.
 */
@Injectable()
export class NhiOAuthClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly nhi: NhiService,
  ) {}

  private find(realm: Realm, nhiIdentityId: string) {
    return this.prisma.client.findFirst({
      where: { realmId: realm.id, nhiIdentityId },
      select: NHI_CLIENT_SELECT,
    });
  }

  async get(realm: Realm, nhiIdentityId: string) {
    await this.nhi.findById(realm, nhiIdentityId);
    const client = await this.find(realm, nhiIdentityId);
    if (!client) {
      throw new NotFoundException('The NHI identity has no OAuth client');
    }
    return this.view(realm, client);
  }

  /**
   * Creates the identity's client, or returns the one it has. The method is
   * the body's, else the one the identity's live certificate credentials
   * imply (all SELF_SIGNED, or all PKI). A request that names a different
   * method or clientId than the existing client's is 409.
   */
  async ensure(realm: Realm, nhiIdentityId: string, dto: NhiOAuthClientDto) {
    const identity = await this.nhi.findById(realm, nhiIdentityId);
    const existing = await this.find(realm, nhiIdentityId);
    if (existing) {
      this.assertMatches(existing, dto);
      return { created: false, client: this.view(realm, existing) };
    }
    if (identity.lifecycleStatus === 'DECOMMISSIONED') {
      throw new ConflictException(
        'A decommissioned NHI identity cannot get an OAuth client',
      );
    }
    const method =
      dto.tokenEndpointAuthMethod ??
      (await this.methodFromCredentials(realm, nhiIdentityId));
    const clientId = dto.clientId ?? `nhi-${identity.id}`;

    try {
      const client = await this.clients.createForNhiIdentity(realm, {
        clientId,
        name: dto.name ?? identity.name,
        nhiIdentityId,
        tokenEndpointAuthMethod: method,
      });
      return { created: true, client: this.view(realm, client) };
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      // Either a concurrent request created the identity's client first, or
      // the clientId is taken by another client.
      const raced = await this.find(realm, nhiIdentityId);
      if (raced) {
        this.assertMatches(raced, dto);
        return { created: false, client: this.view(realm, raced) };
      }
      throw new ConflictException(
        `Client '${clientId}' already exists in realm '${realm.name}'`,
      );
    }
  }

  async remove(realm: Realm, nhiIdentityId: string): Promise<void> {
    await this.nhi.findById(realm, nhiIdentityId);
    const client = await this.find(realm, nhiIdentityId);
    if (!client) {
      throw new NotFoundException('The NHI identity has no OAuth client');
    }
    await this.clients.remove(realm, client.clientId);
  }

  private assertMatches(
    client: { clientId: string; tokenEndpointAuthMethod: string | null },
    dto: NhiOAuthClientDto,
  ): void {
    if (
      dto.tokenEndpointAuthMethod &&
      dto.tokenEndpointAuthMethod !== client.tokenEndpointAuthMethod
    ) {
      throw new ConflictException(
        `The identity's OAuth client uses ${client.tokenEndpointAuthMethod}; delete it to change the method`,
      );
    }
    if (dto.clientId && dto.clientId !== client.clientId) {
      throw new ConflictException(
        `The identity already has OAuth client '${client.clientId}'`,
      );
    }
  }

  private async methodFromCredentials(
    realm: Realm,
    nhiIdentityId: string,
  ): Promise<CertificateMethod> {
    const rows = await this.prisma.nhiCredential.findMany({
      where: {
        realmId: realm.id,
        nhiIdentityId,
        ...liveCertificateCredentialFilter(new Date()),
      },
      select: { tlsAuthMode: true },
      distinct: ['tlsAuthMode'],
    });
    const modes = rows.flatMap((r) => (r.tlsAuthMode ? [r.tlsAuthMode] : []));
    if (modes.length !== 1) {
      throw new BadRequestException(
        modes.length === 0
          ? 'The identity has no certificate credential with a tlsAuthMode; pass tokenEndpointAuthMethod'
          : 'The identity has both SELF_SIGNED and PKI credentials; pass tokenEndpointAuthMethod',
      );
    }
    return METHOD_OF_MODE[modes[0]];
  }

  private view(realm: Realm, client: NhiClientRow) {
    const picked = Object.fromEntries(
      Object.keys(NHI_CLIENT_SELECT).map((key) => [
        key,
        client[key as keyof NhiClientRow],
      ]),
    ) as NhiClientRow;
    return {
      ...picked,
      /** Where the identity asks for tokens, over mutual TLS. */
      tokenEndpoint: `/realms/${realm.name}/protocol/openid-connect/token`,
      /** Certificate authentication also needs this (and MTLS_ENABLED). */
      mtlsClientAuthEnabled: realm.mtlsClientAuthEnabled === true,
    };
  }
}
