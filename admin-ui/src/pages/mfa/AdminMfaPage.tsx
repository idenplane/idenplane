import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  activateTotp,
  getMfaStatus,
  passkeyRegistrationOptions,
  regenerateRecoveryCodes,
  registerPasskey,
  removePasskey,
  removeTotp,
  startTotp,
  type TotpSetup,
} from '../../api/adminMfa';
import { useAuth } from '../../hooks/useAuth';
import { Alert, Badge, Button, Card, Icons, Input } from '../../components/ui';
import ConfirmDialog from '../../components/ConfirmDialog';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { withStepUp } from '../../utils/stepUp';
import { createPasskey, passkeysSupported } from '../../utils/webauthn';
import RecoveryCodesPanel from './RecoveryCodesPanel';

const STATUS_KEY = ['admin-mfa-status'];

/** The base32 secret in groups of four, for typing it in by hand. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : 'never';
}

function TotpEnrolment({
  onActivated,
}: {
  onActivated: (codes: string[] | null, token?: string) => void;
}) {
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const begin = useMutation({ mutationFn: () => withStepUp(startTotp), onSuccess: setSetup });
  const activate = useMutation({
    mutationFn: () => activateTotp(code.trim()),
    onSuccess: (data) => onActivated(data.recoveryCodes, data.access_token),
  });

  if (!setup) {
    return (
      <div>
        {begin.isError && (
          <Alert className="mb-3">{getErrorMessage(begin.error, 'Could not start the setup')}</Alert>
        )}
        <Button icon={Icons.Plus} onClick={() => begin.mutate()} disabled={begin.isPending}>
          Set up an authenticator app
        </Button>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    activate.mutate();
  };

  return (
    <div className="grid gap-5 md:grid-cols-[180px_1fr]">
      <img
        src={setup.qrCodeDataUrl}
        alt="QR code for your authenticator app"
        className="h-[180px] w-[180px] rounded-lg border border-line bg-white p-2"
      />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-muted">
          Scan the QR code with an authenticator app (1Password, Google Authenticator, Microsoft
          Authenticator, Aegis…), or enter this key by hand:
        </p>
        <code
          className="w-fit select-all rounded-md border border-line bg-sunken px-3 py-1.5 font-mono text-[13px] tracking-wide text-fg"
          data-testid="totp-secret"
        >
          {grouped(setup.secret)}
        </code>
        <Input
          label="Code from the app"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          maxLength={8}
          required
        />
        {activate.isError && (
          <Alert>{getErrorMessage(activate.error, 'The code was not accepted')}</Alert>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={activate.isPending || !code.trim()}>
            {activate.isPending ? 'Checking…' : 'Activate'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setSetup(null)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function AddPasskey({
  onAdded,
}: {
  onAdded: (codes: string[] | null, token?: string) => void;
}) {
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: async () => {
      const options = await withStepUp(passkeyRegistrationOptions);
      const response = await createPasskey(options);
      return registerPasskey(response, name.trim());
    },
    onSuccess: (data) => {
      setName('');
      onAdded(data.recoveryCodes, data.access_token);
    },
  });

  if (!passkeysSupported()) {
    return <p className="text-sm text-subtle">This browser cannot use passkeys.</p>;
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="sm:w-72">
        <Input
          label="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Laptop, security key…"
          maxLength={64}
        />
      </div>
      <Button icon={Icons.Plus} onClick={() => add.mutate()} disabled={add.isPending}>
        {add.isPending ? 'Waiting for the passkey…' : 'Add a passkey'}
      </Button>
      {add.isError && (
        <Alert>{getErrorMessage(add.error, 'The passkey was not registered')}</Alert>
      )}
    </div>
  );
}

/**
 * The signed-in admin's second factors for the console: an authenticator
 * app (TOTP), passkeys, and recovery codes. Shown on its own, outside the
 * console layout, so an admin who must enrol first can reach it.
 */
export default function AdminMfaPage() {
  const queryClient = useQueryClient();
  const { keepToken, logout } = useAuth();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: 'totp' } | { kind: 'passkey'; id: string; name: string } | null
  >(null);
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: getMfaStatus });

  const refresh = () => queryClient.invalidateQueries({ queryKey: STATUS_KEY });
  const enrolled = (newCodes: string[] | null, token?: string) => {
    if (token) keepToken(token);
    if (newCodes && newCodes.length > 0) setCodes(newCodes);
    void refresh();
  };

  const remove = useMutation({
    mutationFn: (target: NonNullable<typeof confirm>) =>
      withStepUp(() => (target.kind === 'totp' ? removeTotp() : removePasskey(target.id))),
    onSuccess: () => {
      setConfirm(null);
      void refresh();
    },
    onError: () => setConfirm(null),
  });
  const regenerate = useMutation({
    mutationFn: () => withStepUp(regenerateRecoveryCodes),
    onSuccess: (newCodes) => {
      setCodes(newCodes);
      void refresh();
    },
  });

  const data = status.data;
  const mustEnrol = !!data && data.policy.required && !data.enrolled;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Icons.IpMark size={28} fg="var(--fg)" accent="#10b981" />
          <span className="text-[15px] font-semibold text-fg">idenplane</span>
        </div>
        <div className="flex items-center gap-2">
          {!mustEnrol && (
            <Link to="/console" className="text-sm font-medium text-accent hover:text-accent-hover">
              Back to the console
            </Link>
          )}
          <Button size="sm" variant="secondary" icon={Icons.Logout} onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold text-fg">Two-factor authentication</h1>
          <p className="mt-1 text-sm text-muted">
            A second factor protects your admin account if your password is stolen. Once you have
            one, the console asks for it every time you sign in.
          </p>
        </div>

        {status.isLoading && <p className="text-sm text-subtle">Loading…</p>}
        {status.isError && (
          <Alert>{getErrorMessage(status.error, 'Could not load your second factors')}</Alert>
        )}

        {mustEnrol && (
          <Alert variant="warning" title="Set up a second factor to continue">
            This server requires a second factor for every admin. Set up an authenticator app or a
            passkey; the rest of the console opens once you have.
          </Alert>
        )}

        {codes && (
          <RecoveryCodesPanel
            codes={codes}
            onDone={() => setCodes(null)}
          />
        )}

        {data && !codes && data.enrolled && data.policy.required && (
          <Alert variant="success" title="You're set up">
            Your account has a second factor.{' '}
            <Link to="/console" className="font-medium underline">
              Continue to the console
            </Link>
          </Alert>
        )}

        {data && (
          <>
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-fg">Authenticator app</h2>
                  <p className="text-sm text-muted">Six-digit codes from an app on your phone.</p>
                </div>
                {data.totp && <Badge variant="success">On</Badge>}
              </div>
              {data.totp ? (
                <Button
                  size="sm"
                  variant="danger"
                  icon={Icons.Trash}
                  onClick={() => setConfirm({ kind: 'totp' })}
                >
                  Remove the authenticator app
                </Button>
              ) : (
                <TotpEnrolment onActivated={enrolled} />
              )}
            </Card>

            <Card>
              <div className="mb-4">
                <h2 className="text-base font-semibold text-fg">Passkeys</h2>
                <p className="text-sm text-muted">
                  A security key, or the passkey built into your computer or phone.
                </p>
              </div>
              {data.passkeys.length > 0 && (
                <ul className="mb-4 divide-y divide-line rounded-lg border border-line">
                  {data.passkeys.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div>
                        <div className="text-sm font-medium text-fg">{p.name ?? 'Passkey'}</div>
                        <div className="text-xs text-subtle">
                          Added {formatDate(p.createdAt)} · last used {formatDate(p.lastUsedAt)}
                        </div>
                      </div>
                      <Button
                        size="xs"
                        variant="danger"
                        aria-label={`Remove passkey ${p.name ?? ''}`.trim()}
                        onClick={() =>
                          setConfirm({ kind: 'passkey', id: p.id, name: p.name ?? 'this passkey' })
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <AddPasskey onAdded={enrolled} />
            </Card>

            {data.enrolled && (
              <Card>
                <h2 className="text-base font-semibold text-fg">Recovery codes</h2>
                <p className="mt-1 text-sm text-muted">
                  {data.recoveryCodes.remaining} unused recovery code
                  {data.recoveryCodes.remaining === 1 ? '' : 's'} left.
                </p>
                {data.recoveryCodes.oldFormat && (
                  <Alert variant="warning" className="mt-3" title="Old-format recovery codes">
                    Some of your codes were issued before Idenplane 0.11.0 and are weaker. Generate
                    new ones.
                  </Alert>
                )}
                {regenerate.isError && (
                  <Alert className="mt-3">
                    {getErrorMessage(regenerate.error, 'Could not generate new codes')}
                  </Alert>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => regenerate.mutate()}
                  disabled={regenerate.isPending}
                >
                  Generate new recovery codes
                </Button>
              </Card>
            )}

            {remove.isError && (
              <Alert>{getErrorMessage(remove.error, 'Could not remove the factor')}</Alert>
            )}
          </>
        )}
      </main>

      <ConfirmDialog
        isOpen={confirm !== null}
        title={confirm?.kind === 'totp' ? 'Remove the authenticator app?' : 'Remove the passkey?'}
        message={
          confirm?.kind === 'passkey'
            ? `${confirm.name} will no longer sign you in.`
            : 'Its codes will no longer sign you in.'
        }
        confirmText="Remove"
        confirmDisabled={remove.isPending}
        onConfirm={() => confirm && remove.mutate(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
