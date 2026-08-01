import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRealmByName, deleteRealm, exportRealm } from '../../api/realms';
import ConfirmDialog from '../../components/ConfirmDialog';
import MagicLinkSettingsForm from '../../components/magic-link/MagicLinkSettingsForm';
import EmailProviderForm from '../../components/email/EmailProviderForm';
import SmsProviderForm from '../../components/sms/SmsProviderForm';
import GeneralSettingsForm from '../../components/realms/GeneralSettingsForm';
import TokenSettingsForm from '../../components/realms/TokenSettingsForm';
import SecuritySettingsForm from '../../components/realms/SecuritySettingsForm';
import EventSettingsForm from '../../components/realms/EventSettingsForm';
import ThemeSettingsForm from '../../components/realms/ThemeSettingsForm';
import LocaleSettingsForm from '../../components/realms/LocaleSettingsForm';

export default function RealmDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDelete, setShowDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'tokens' | 'email' | 'sms' | 'security' | 'events' | 'theme' | 'magic-link' | 'locale'>('general');

  const { data: realm, isLoading } = useQuery({
    queryKey: ['realm', name],
    queryFn: () => getRealmByName(name!),
    enabled: !!name,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRealm(name!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['realms'] });
      navigate('/console/realms');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading realm...</div>
      </div>
    );
  }

  if (!realm) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        Realm not found.
      </div>
    );
  }

  const tabs = [
    { key: 'general' as const, label: 'General' },
    { key: 'tokens' as const, label: 'Tokens' },
    { key: 'email' as const, label: 'Email' },
    { key: 'sms' as const, label: 'SMS' },
    { key: 'security' as const, label: 'Security' },
    { key: 'events' as const, label: 'Events' },
    { key: 'theme' as const, label: 'Theme' },
    { key: 'magic-link' as const, label: 'Magic Link' },
    { key: 'locale' as const, label: 'Locale' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">{realm.name}</h1>
          <p className="mt-1 text-sm text-subtle">
            {realm.displayName || 'Realm settings and overview'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              const data = await exportRealm(name!, { includeUsers: true });
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${name}-realm-export.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-muted hover:bg-hover"
          >
            Export Realm
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-md border border-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger-soft"
          >
            Delete Realm
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-line">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 py-3 text-sm font-medium ${
                activeTab === tab.key
                  ? 'border-accent text-accent'
                  : 'border-transparent text-subtle hover:border-line-strong hover:text-fg'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'general' && <GeneralSettingsForm realm={realm} />}
      {activeTab === 'tokens' && <TokenSettingsForm realm={realm} />}
      {activeTab === 'email' && <EmailProviderForm realm={realm} />}
      {activeTab === 'sms' && <SmsProviderForm realm={realm} />}
      {activeTab === 'security' && <SecuritySettingsForm realm={realm} />}
      {activeTab === 'events' && <EventSettingsForm realm={realm} />}
      {activeTab === 'theme' && <ThemeSettingsForm realm={realm} />}
      {activeTab === 'magic-link' && <MagicLinkSettingsForm realm={realm} />}
      {activeTab === 'locale' && <LocaleSettingsForm realm={realm} />}

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Realm"
        message={`Are you sure you want to delete the realm "${realm.name}"? This action is irreversible and will delete all associated users, clients, and roles.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
