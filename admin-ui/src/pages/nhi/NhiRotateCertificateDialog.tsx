import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { rotateNhiCredential } from '../../api/nhi';
import type { NhiCredential } from '../../types';

interface Props {
  realmName: string;
  identityId: string;
  credential: NhiCredential;
  onClose: () => void;
  onRotated: () => void;
}

/**
 * Rotation with overlap for a certificate credential: the new certificate
 * (SELF_SIGNED) or rule (PKI) takes over, and the old one keeps working for
 * the overlap so the device can switch without downtime.
 */
export default function NhiRotateCertificateDialog({
  realmName,
  identityId,
  credential,
  onClose,
  onRotated,
}: Props) {
  const selfSigned = credential.tlsAuthMode === 'SELF_SIGNED';
  const [certificatePem, setCertificatePem] = useState('');
  // Empty: the policy's overlap, else 24 hours.
  const [overlapHours, setOverlapHours] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      rotateNhiCredential(realmName, identityId, credential.id, {
        ...(selfSigned ? { certificatePem } : {}),
        ...(overlapHours !== '' ? { overlapSeconds: Math.round(Number(overlapHours) * 3600) } : {}),
      }),
    onSuccess: () => {
      onRotated();
      onClose();
    },
  });

  const error = (mutation.error as { response?: { data?: { message?: string } } } | null)?.response
    ?.data?.message;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rotate-cert-title"
        className="relative z-10 w-full max-w-lg rounded-lg bg-surface p-6 shadow-xl"
      >
        <h3 id="rotate-cert-title" className="text-lg font-semibold text-fg">
          Rotate {credential.name}
        </h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="mt-4 space-y-4"
        >
          {selfSigned ? (
            <div>
              <label htmlFor="field-rotate-pem" className="mb-1.5 block text-sm font-medium text-muted">
                New certificate (PEM)
              </label>
              <textarea
                id="field-rotate-pem"
                value={certificatePem}
                onChange={(e) => setCertificatePem(e.target.value)}
                required
                rows={6}
                placeholder="-----BEGIN CERTIFICATE-----"
                className="w-full rounded-md border border-line-strong px-3 py-2 font-mono text-xs shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
              <p className="mt-1 text-xs text-subtle">The certificate only. A private key is refused.</p>
            </div>
          ) : (
            <p className="text-sm text-subtle">The new credential keeps this credential&apos;s subject rule.</p>
          )}
          <div>
            <label htmlFor="field-rotate-overlap" className="mb-1.5 block text-sm font-medium text-muted">
              Overlap (hours)
            </label>
            <input
              id="field-rotate-overlap"
              type="number"
              min={0}
              max={720}
              step="any"
              value={overlapHours}
              onChange={(e) => setOverlapHours(e.target.value)}
              placeholder="Policy default, else 24"
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
            <p className="mt-1 text-xs text-subtle">
              How long the current certificate keeps working after the new one is added.
            </p>
          </div>
          {mutation.isError && (
            <div role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
              {error ?? 'Failed to rotate the credential.'}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {mutation.isPending ? 'Rotating...' : 'Rotate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
