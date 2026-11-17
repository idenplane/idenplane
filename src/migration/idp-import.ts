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
import type { MigrationReport } from './migration-report.js';

/** An identity provider from a migration source, in Idenplane's terms. */
export interface IdpImportInput {
  alias: string;
  /** The Idenplane provider type it maps to, or the source's own type when it has no mapping. */
  providerType: string | null | undefined;
  /** Fills fixed endpoints for Google, GitHub and Microsoft connections. */
  wellKnown?: keyof typeof WELL_KNOWN_PROVIDERS | null;
  fields: BrokerFields;
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
      providerType: IdpProviderType;
      fields: PlannedFields;
      /** Disabled at the source, or no usable client secret in the export. */
      enabled: boolean;
      /** False when the export has no usable client secret. */
      hasSecret: boolean;
    };

/**
 * Decides whether an identity provider can be imported so that the broker
 * can use it: a supported provider type (see SUPPORTED_IDP_PROVIDER_TYPES —
 * SAML is not), a client ID and http(s) authorization and token URLs. A
 * provider without a usable client secret is imported, but disabled.
 */
export function planIdpImport(input: IdpImportInput): IdpImportPlan {
  const providerType = supportedIdpProviderType(input.providerType);
  if (!providerType) {
    return { skip: true, reason: unsupportedIdpTypeReason(input.providerType) };
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
 * secret gets a warning too. Returns whether to create it.
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
