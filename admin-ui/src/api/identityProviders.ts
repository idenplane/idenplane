import apiClient from './client';
import type {
  IdentityProvider,
  SamlIdpConfig,
  SamlMetadataFields,
} from '../types';

export async function getIdentityProviders(
  realmName: string,
): Promise<IdentityProvider[]> {
  const { data } = await apiClient.get<IdentityProvider[]>(
    `/realms/${realmName}/identity-providers`,
  );
  return data;
}

export async function getIdentityProvider(
  realmName: string,
  alias: string,
): Promise<IdentityProvider> {
  const { data } = await apiClient.get<IdentityProvider>(
    `/realms/${realmName}/identity-providers/${alias}`,
  );
  return data;
}

export interface CreateIdpPayload {
  alias: string;
  displayName?: string;
  enabled?: boolean;
  providerType?: string;
  /** oidc/oauth2 only. */
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  jwksUrl?: string;
  issuer?: string;
  defaultScopes?: string;
  trustEmail?: boolean;
  linkOnly?: boolean;
  syncUserProfile?: boolean;
  /** saml only. */
  samlConfig?: Partial<SamlIdpConfig>;
}

export async function createIdentityProvider(
  realmName: string,
  payload: CreateIdpPayload,
): Promise<IdentityProvider> {
  const { data } = await apiClient.post<IdentityProvider>(
    `/realms/${realmName}/identity-providers`,
    payload,
  );
  return data;
}

export async function updateIdentityProvider(
  realmName: string,
  alias: string,
  payload: Partial<CreateIdpPayload>,
): Promise<IdentityProvider> {
  const { data } = await apiClient.put<IdentityProvider>(
    `/realms/${realmName}/identity-providers/${alias}`,
    payload,
  );
  return data;
}

export async function deleteIdentityProvider(
  realmName: string,
  alias: string,
): Promise<void> {
  await apiClient.delete(
    `/realms/${realmName}/identity-providers/${alias}`,
  );
}

/** Reads IdP metadata (pasted XML or a URL) into SAML settings; stores nothing. */
export async function readSamlMetadata(
  realmName: string,
  source: { xml: string } | { url: string },
): Promise<SamlMetadataFields> {
  const { data } = await apiClient.post<SamlMetadataFields>(
    `/realms/${realmName}/identity-providers/saml-metadata`,
    source,
  );
  return data;
}
