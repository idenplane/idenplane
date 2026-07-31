import { useState, type FormEvent, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { saveRealmSettings, type RealmSettingsData } from '../../../api/wizard';
import { useWizard } from '../../../context/WizardContext';
import { getErrorMessage } from '../../../utils/getErrorMessage';

/**
 * Validates realm name according to Keycloak conventions:
 * - Lowercase letters, numbers, and hyphens only
 * - Must start with a letter
 * - Cannot end with a hyphen
 * - Minimum 2 characters
 */
function validateRealmName(name: string): string | null {
  if (!name) {
    return 'Realm name is required.';
  }
  if (name.length < 2) {
    return 'Realm name must be at least 2 characters.';
  }
  if (!/^[a-z]/.test(name)) {
    return 'Realm name must start with a lowercase letter.';
  }
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(name)) {
    return 'Realm name can only contain lowercase letters, numbers, and hyphens. It must not end with a hyphen.';
  }
  return null;
}

export default function RealmSettingsStep() {
  const { setRealmSettings } = useWizard();
  const [form, setForm] = useState<RealmSettingsData>({
    name: '',
    displayName: '',
  });
  const [localError, setLocalError] = useState<string | null>(null);

  const realmNameError = form.name ? validateRealmName(form.name) : null;
  const isFormValid = form.name && !realmNameError;

  const mutation = useMutation({
    mutationFn: (data: RealmSettingsData) => saveRealmSettings(data),
    onSuccess: (result) => {
      if (result.realmName) {
        setRealmSettings({
          name: result.realmName,
          displayName: result.realmDisplayName || undefined,
        });
      }
    },
  });

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setLocalError(null);

      const nameError = validateRealmName(form.name);
      if (nameError) {
        setLocalError(nameError);
        return;
      }

      mutation.mutate(form);
    },
    [form, mutation],
  );

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-fg">Configure Master Realm</h2>
        <p className="mt-1 text-sm text-subtle">
          Set up your master realm, which manages all other realms and global settings.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="realmName" className="mb-1.5 block text-sm font-medium text-muted">
            Realm Name
          </label>
          <input
            id="realmName"
            name="name"
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })}
            placeholder="master"
            className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:ring-1 focus:outline-none ${realmNameError ? 'border-danger focus:border-danger focus:ring-danger' : 'border-line-strong focus:border-accent focus:ring-accent'}`}
          />
          {realmNameError ? (
            <p className="mt-1 text-xs text-danger">{realmNameError}</p>
          ) : (
            <p className="mt-1 text-xs text-subtle">
              Unique identifier: lowercase letters, numbers, and hyphens only. Must start with a letter.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-fg">
            Display Name
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="Master Realm"
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-subtle">
            A human-readable name shown in the admin console. Optional.
          </p>
        </div>

        {localError && (
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg"
          >
            {localError}
          </div>
        )}

        {mutation.isError && (
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg"
          >
            {getErrorMessage(mutation.error, 'Failed to save realm settings.')}
          </div>
        )}

        <div className="flex justify-end border-t border-line pt-4">
          <button
            type="submit"
            disabled={mutation.isPending || !isFormValid}
            className="flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Saving...</span>
              </>
            ) : (
              <span>Save & Continue</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
