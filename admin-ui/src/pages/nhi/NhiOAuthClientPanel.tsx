import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createNhiOAuthClient,
  deleteNhiOAuthClient,
  getNhiOAuthClient,
  type NhiClientAuthMethod,
} from '../../api/nhi';
import ConfirmDialog from '../../components/ConfirmDialog';

const METHOD_LABELS: Record<NhiClientAuthMethod, string> = {
  self_signed_tls_client_auth: 'Self-signed certificate (self_signed_tls_client_auth)',
  tls_client_auth: 'CA-issued certificate (tls_client_auth)',
};

interface Props {
  realmName: string;
  identityId: string;
  /** A decommissioned identity cannot get a client. */
  readOnly?: boolean;
}

/**
 * The identity's OAuth client (RFC 8705 NHI binding): the device asks the
 * realm's token endpoint for client_credentials tokens with its own
 * certificate, and the tokens are always certificate-bound.
 */
export default function NhiOAuthClientPanel({ realmName, identityId, readOnly }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ['nhi-oauth-client', realmName, identityId];
  const [method, setMethod] = useState<'' | NhiClientAuthMethod>('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: client, isLoading } = useQuery({
    queryKey,
    queryFn: () => getNhiOAuthClient(realmName, identityId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createNhiOAuthClient(realmName, identityId, method ? { tokenEndpointAuthMethod: method } : {}),
    onSuccess: (created) => queryClient.setQueryData(queryKey, created),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteNhiOAuthClient(realmName, identityId),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, null);
      setConfirmDelete(false);
    },
  });

  const createError = (createMutation.error as { response?: { data?: { message?: string } } } | null)
    ?.response?.data?.message;

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-fg">OAuth client</h2>
        <p className="mt-1 text-sm text-subtle">
          The identity authenticates at the realm&apos;s token endpoint with its own certificate
          (client_credentials) and receives certificate-bound tokens.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-subtle">Loading OAuth client...</p>
      ) : client ? (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-subtle">Client ID</dt>
              <dd className="mt-0.5 font-mono text-fg break-all">{client.clientId}</dd>
            </div>
            <div>
              <dt className="text-subtle">Authentication</dt>
              <dd className="mt-0.5 text-fg">{METHOD_LABELS[client.tokenEndpointAuthMethod]}</dd>
            </div>
            <div>
              <dt className="text-subtle">Token endpoint</dt>
              <dd className="mt-0.5 font-mono text-fg break-all">{client.tokenEndpoint}</dd>
            </div>
            <div>
              <dt className="text-subtle">Tokens</dt>
              <dd className="mt-0.5 text-fg">Always bound to the certificate (cnf)</dd>
            </div>
          </dl>
          {!client.mtlsClientAuthEnabled && (
            <div role="status" className="rounded-md bg-warning-soft p-3 text-sm text-warning-fg">
              Certificate authentication is off for this realm, so this client cannot get tokens
              until the realm&apos;s mTLS client authentication is turned on.
            </div>
          )}
          {!readOnly && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-md border border-danger-soft px-3 py-1.5 text-sm font-medium text-danger-fg hover:bg-danger-soft"
            >
              Delete OAuth client
            </button>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-subtle">This identity has no OAuth client.</p>
          {!readOnly && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="field-nhi-client-method" className="mb-1.5 block text-sm font-medium text-muted">
                  Authentication
                </label>
                <select
                  id="field-nhi-client-method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as '' | NhiClientAuthMethod)}
                  className="rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                >
                  <option value="">From the identity&apos;s certificate credentials</option>
                  <option value="self_signed_tls_client_auth">{METHOD_LABELS.self_signed_tls_client_auth}</option>
                  <option value="tls_client_auth">{METHOD_LABELS.tls_client_auth}</option>
                </select>
              </div>
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create OAuth client'}
              </button>
            </div>
          )}
          {createMutation.isError && (
            <div role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
              {createError ?? 'Failed to create the OAuth client.'}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete OAuth client"
        message="The device will no longer get tokens, and its tokens will stop introspecting as active."
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
