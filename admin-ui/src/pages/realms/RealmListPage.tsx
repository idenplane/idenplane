import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { getAllRealms, importRealm } from '../../api/realms';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { SectionHeader, Button, Card, Badge, Alert, EmptyState, Icons } from '../../components/ui';

export default function RealmListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const { data: realms, isLoading, error } = useQuery({
    queryKey: ['realms'],
    queryFn: getAllRealms,
    staleTime: 60_000,
  });

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const result = await importRealm(payload);
      setImportStatus({ type: 'success', message: `Realm "${String(result.realmName ?? '')}" imported successfully.` });
      queryClient.invalidateQueries({ queryKey: ['realms'] });
    } catch (err: unknown) {
      setImportStatus({ type: 'error', message: getErrorMessage(err, 'Import failed.') });
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading realms...</div>
      </div>
    );
  }

  if (error) {
    return <Alert variant="danger">Failed to load realms. Please try again.</Alert>;
  }

  return (
    <div>
      <SectionHeader
        title="Realms"
        hint="Manage your identity realms"
        action={
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              aria-label="Import realm JSON file"
              className="hidden"
            />
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              Import Realm
            </Button>
            <Button icon={Icons.Plus} onClick={() => navigate('/console/realms/create')}>
              Create Realm
            </Button>
          </div>
        }
      />

      {importStatus && (
        <Alert
          variant={importStatus.type === 'success' ? 'success' : 'danger'}
          aria-live={importStatus.type === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
          className="mb-4"
        >
          {importStatus.message}
          <button
            onClick={() => setImportStatus(null)}
            aria-label="Dismiss notification"
            className="ml-2 underline"
          >
            dismiss
          </button>
        </Alert>
      )}

      <Card padding="none">
        <table className="min-w-full divide-y divide-line" aria-label="Realms">
          <thead className="bg-sunken">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Name
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Display Name
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Enabled
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {realms && realms.length > 0 ? (
              realms.map((realm) => (
                <tr
                  key={realm.id}
                  onClick={() => navigate(`/console/realms/${realm.name}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/console/realms/${realm.name}`);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`View realm ${realm.displayName || realm.name}`}
                  className="cursor-pointer hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-accent">
                    {realm.name}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                    {realm.displayName}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <Badge variant={realm.enabled ? 'success' : 'neutral'} size="sm">
                      {realm.enabled ? 'Yes' : 'No'}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(realm.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="p-0">
                  <EmptyState icon={Icons.Realms} title="No realms found. Create your first realm to get started." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
