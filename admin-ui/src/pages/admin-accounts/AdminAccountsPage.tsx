import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAdminAccounts,
  setAdminRealms,
  type AdminAccount,
} from '../../api/adminAccess';
import { getAllRealms } from '../../api/realms';
import { Alert, Badge, Button, Card } from '../../components/ui';
import { getErrorMessage } from '../../utils/getErrorMessage';

const MASTER = 'master';

function RealmEditor({
  account,
  realmNames,
  onDone,
}: {
  account: AdminAccount;
  realmNames: string[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set(account.realms));
  const save = useMutation({
    mutationFn: () => setAdminRealms(account.id, [...selected].sort()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });
      onDone();
    },
  });
  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="mt-3 rounded-lg border border-line bg-sunken p-3">
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">
          Realms {account.username} manages
        </legend>
        {realmNames.length === 0 && (
          <p className="text-sm text-subtle">There are no realms besides master.</p>
        )}
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {realmNames.map((name) => (
            <label key={name} className="flex items-center gap-2 font-mono text-[12.5px] text-fg">
              <input
                type="checkbox"
                checked={selected.has(name)}
                onChange={() => toggle(name)}
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      {save.isError && (
        <Alert className="mt-3">{getErrorMessage(save.error, 'Could not save the realms')}</Alert>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save realms'}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Super-admin only: the master realm's admin accounts, their roles, and the
 * realms each realm-admin manages. A realm-admin with no realm manages none.
 */
export default function AdminAccountsPage() {
  const [editing, setEditing] = useState<string | null>(null);
  const accounts = useQuery({ queryKey: ['admin-accounts'], queryFn: listAdminAccounts });
  const realms = useQuery({ queryKey: ['realms'], queryFn: getAllRealms });
  const realmNames = (realms.data ?? [])
    .map((r) => r.name)
    .filter((n) => n !== MASTER)
    .sort();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Admin Accounts</h1>
        <p className="mt-1 text-sm text-muted">
          Admins of the master realm and what they may do. <strong>super-admin</strong>: everything.{' '}
          <strong>realm-admin</strong>: reads and changes the realms assigned below, nothing else.{' '}
          <strong>view-only</strong>: reads every realm, changes nothing. Roles are assigned on the
          master realm&apos;s users.
        </p>
      </div>

      {accounts.isError && (
        <Alert>{getErrorMessage(accounts.error, 'Could not load the admin accounts')}</Alert>
      )}
      {accounts.isLoading && <p className="text-sm text-subtle">Loading…</p>}

      {accounts.data?.some((a) => a.roles.includes('realm-admin') && a.realms.length === 0) && (
        <Alert variant="warning" title="Realm-admins without realms">
          These realm-admins manage no realm until you assign one.
        </Alert>
      )}

      <div className="space-y-3">
        {accounts.data?.map((account) => {
          const isRealmAdmin = account.roles.includes('realm-admin');
          return (
            <Card key={account.id} padding="sm" data-testid={`admin-account-${account.username}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{account.username}</span>
                    {!account.enabled && <Badge variant="danger" size="sm">disabled</Badge>}
                    {account.roles.map((role) => (
                      <Badge key={role} variant={role === 'super-admin' ? 'accent' : 'neutral'} size="sm">
                        {role}
                      </Badge>
                    ))}
                  </div>
                  {account.email && <p className="mt-0.5 text-xs text-subtle">{account.email}</p>}
                  {isRealmAdmin && (
                    <p className="mt-1.5 text-sm text-muted">
                      Realms:{' '}
                      {account.realms.length > 0 ? (
                        <span className="font-mono text-[12.5px] text-fg">{account.realms.join(', ')}</span>
                      ) : (
                        <span className="text-warning-fg">none</span>
                      )}
                    </p>
                  )}
                </div>
                {isRealmAdmin && editing !== account.id && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(account.id)}>
                    Edit realms
                  </Button>
                )}
              </div>
              {isRealmAdmin && editing === account.id && (
                <RealmEditor
                  account={account}
                  realmNames={realmNames}
                  onDone={() => setEditing(null)}
                />
              )}
            </Card>
          );
        })}
        {accounts.data?.length === 0 && (
          <p className="text-sm text-subtle">No admin accounts found.</p>
        )}
      </div>
    </div>
  );
}
