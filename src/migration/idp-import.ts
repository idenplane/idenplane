import type { WELL_KNOWN_PROVIDERS } from '../broker/providers.js';
import {
  type BrokerFields,
  type IdpProviderType,
  hasUsableSecret,
  missingBrokerFields,
  supportedIdpProviderType,
  unsupportedIdpTypeReason,
  withWellKnownEndpoints,
} from '../identity-providers/idp-provider-types.js';
import {
  SAML_UNUSED_OAUTH_COLUMNS,
  validateSamlConfig,
  type SamlIdpConfig,
} from '../identity-providers/saml-config.js';
import {
  IdpMetadataError,
  parseIdpMetadata,
} from '../broker/saml/saml-sp-messages.js';
import type { Prisma } from '@prisma/client';
import type { MigrationReport } from './migration-report.js';

/** An identity provider from a migration source, in Idenplane's terms. */
export interface IdpImportInput {
  alias: string;
  /** The Idenplane provider type it maps to, or the source's own type when it has no mapping. */
  providerType: string | null | undefined;
  /** Fills fixed endpoints for Google, GitHub and Microsoft connections. */
  wellKnown?: keyof typeof WELL_KNOWN_PROVIDERS | null;
  fields: BrokerFields;
  /**
   * For `saml`: the settings the source exported, as a raw samlConfig
   * (checked by validateSamlConfig, like the admin API's).
   */
  saml?: Record<string, unknown>;
  /** Whether the provider is enabled at the source (default true). */
  enabled?: boolean;
}

type PlannedFields = BrokerFields & {
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
};

export type IdpImportPlan =
  | { skip: true; reason: string }
  | {
      skip: false;
      providerType: Exclude<IdpProviderType, 'saml'>;
      fields: PlannedFields;
      /** Disabled at the source, or no usable client secret in the export. */
      enabled: boolean;
      /** False when the export has no usable client secret. */
      hasSecret: boolean;
    }
  | {
      skip: false;
      providerType: 'saml';
      samlConfig: SamlIdpConfig;
      enabled: boolean;
      /** SAML providers have no client secret. */
      hasSecret: true;
    };

/**
 * Decides whether an identity provider can be imported so that the broker
 * can use it:
 *
 * - `oidc`/`oauth2`: a client ID and http(s) authorization and token URLs;
 *   a provider without a usable client secret is imported, but disabled.
 * - `saml`: settings that pass validateSamlConfig (IdP entity ID, SSO URL,
 *   a usable signing certificate, …); otherwise skipped with every reason.
 */
export function planIdpImport(input: IdpImportInput): IdpImportPlan {
  const providerType = supportedIdpProviderType(input.providerType);
  if (!providerType) {
    return { skip: true, reason: unsupportedIdpTypeReason(input.providerType) };
  }
  if (providerType === 'saml') {
    const result = validateSamlConfig(input.saml ?? {});
    if (!result.ok) {
      return {
        skip: true,
        reason: `the export's SAML settings are incomplete or unusable (${result.errors.join('; ')}). Add it in the admin console, from the IdP's metadata.`,
      };
    }
    return {
      skip: false,
      providerType,
      samlConfig: result.config,
      enabled: input.enabled ?? true,
      hasSecret: true,
    };
  }
  const fields = withWellKnownEndpoints(input.wellKnown ?? null, input.fields);
  const missing = missingBrokerFields(fields);
  if (missing.length) {
    return {
      skip: true,
      reason: `the export has no usable ${missing.join(', ')}, which the broker needs to sign users in.`,
    };
  }
  const hasSecret = hasUsableSecret(fields.clientSecret);
  return {
    skip: false,
    providerType,
    fields: fields as PlannedFields,
    enabled: (input.enabled ?? true) && hasSecret,
    hasSecret,
  };
}

/**
 * Applies a plan to the report: a skipped provider is counted as skipped
 * with a warning naming it and the reason; a provider imported without its
 * secret gets a warning too, and so does every SAML provider (the IdP must
 * be given Idenplane's SP metadata). Returns whether to create it.
 */
export function reportIdpPlan(
  report: MigrationReport,
  alias: string,
  plan: IdpImportPlan,
): plan is Extract<IdpImportPlan, { skip: false }> {
  if (plan.skip) {
    report.summary.identityProviders.skipped++;
    report.warnings.push({
      entity: 'identity_provider',
      message: `Identity provider '${alias}' was not imported: ${plan.reason}`,
    });
    return false;
  }
  if (plan.providerType === 'saml') {
    report.warnings.push({
      entity: 'identity_provider',
      message: `Identity provider '${alias}' was imported as a SAML identity provider. Idenplane is a new service provider for it: register Idenplane's SP metadata (/realms/{realm}/broker/${alias}/saml/metadata; new entity ID and ACS URL) at the IdP before users sign in.`,
    });
    return true;
  }
  if (!plan.hasSecret) {
    report.warnings.push({
      entity: 'identity_provider',
      message: `Identity provider '${alias}' has no client secret in the export; it was imported disabled. Set the secret and enable it.`,
    });
  }
  return true;
}

/** Prisma create data for a planned provider. */
export function idpCreateData(
  plan: Extract<IdpImportPlan, { skip: false }>,
  sealSecret: (secret: string) => string,
) {
  if (plan.providerType === 'saml') {
    return {
      providerType: plan.providerType,
      enabled: plan.enabled,
      ...SAML_UNUSED_OAUTH_COLUMNS,
      clientSecret: sealSecret(''),
      samlConfig: plan.samlConfig as unknown as Prisma.InputJsonValue,
    };
  }
  const f = plan.fields;
  return {
    providerType: plan.providerType,
    enabled: plan.enabled,
    clientId: f.clientId,
    clientSecret: sealSecret(plan.hasSecret ? (f.clientSecret ?? '') : ''),
    authorizationUrl: f.authorizationUrl,
    tokenUrl: f.tokenUrl,
    userinfoUrl: f.userinfoUrl || null,
    jwksUrl: f.jwksUrl || null,
    issuer: f.issuer || null,
    ...(f.defaultScopes ? { defaultScopes: f.defaultScopes } : {}),
  };
}

/**
 * A raw samlConfig from IdP metadata an export carries (Auth0's
 * `metadataXml`, Zitadel's base64 `metadataXml`), or null with the reason.
 */
export function samlFromMetadata(
  metadata: unknown,
): { saml: Record<string, unknown> } | { reason: string } {
  if (typeof metadata !== 'string' || !metadata.trim()) {
    return { reason: 'the export carries no IdP metadata' };
  }
  let xml = metadata.trim();
  if (!xml.startsWith('<')) {
    const decoded = Buffer.from(xml, 'base64').toString('utf-8').trim();
    if (!decoded.startsWith('<')) {
      return { reason: 'the exported IdP metadata is not XML' };
    }
    xml = decoded;
  }
  try {
    const fields = parseIdpMetadata(xml);
    return { saml: { ...fields } };
  } catch (err) {
    if (err instanceof IdpMetadataError) return { reason: err.message };
    throw err;
  }
}
