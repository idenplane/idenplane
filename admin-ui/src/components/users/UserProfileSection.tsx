import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { User } from '../../types';
import { updateUser } from '../../api/users';
import { useFormSeed } from '../../hooks/useFormSeed';

type UserProfileSectionProps = {
  realmName: string;
  userId: string;
  user: User;
};

function seedFromUser(user: User) {
  return {
    email: user.email ?? '',
    emailVerified: user.emailVerified,
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    enabled: user.enabled,
  };
}

export default function UserProfileSection({ realmName, userId, user }: UserProfileSectionProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useFormSeed(user, seedFromUser);

  const updateMutation = useMutation({
    mutationFn: () => updateUser(realmName, userId, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user', realmName, userId] });
      queryClient.invalidateQueries({ queryKey: ['users', realmName] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-line bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-fg">Profile</h2>

      <div>
        <label htmlFor="field-user-username" className="mb-1.5 block text-sm font-medium text-muted">Username</label>
        <input
          id="field-user-username"
          type="text"
          value={user.username}
          disabled
          className="w-full rounded-md border border-line bg-sunken px-3 py-2 text-sm text-subtle"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="field-user-email" className="mb-1.5 block text-sm font-medium text-muted">Email</label>
          <input
            id="field-user-email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>
        <div className="flex items-end gap-2 pb-1">
          <input
            type="checkbox"
            id="emailVerified"
            checked={form.emailVerified}
            onChange={(e) => setForm({ ...form, emailVerified: e.target.checked })}
            className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
          />
          <label htmlFor="emailVerified" className="text-sm font-medium text-muted">
            Email Verified
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="field-user-firstName" className="mb-1.5 block text-sm font-medium text-muted">First Name</label>
          <input
            id="field-user-firstName"
            type="text"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="field-user-lastName" className="mb-1.5 block text-sm font-medium text-muted">Last Name</label>
          <input
            id="field-user-lastName"
            type="text"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="enabled"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="h-4 w-4 rounded border-line-strong text-accent focus:ring-accent"
        />
        <label htmlFor="enabled" className="text-sm font-medium text-muted">
          Enabled
        </label>
      </div>

      {updateMutation.isSuccess && (
        <div className="rounded-md bg-success-soft p-3 text-sm text-success-fg">
          User updated successfully.
        </div>
      )}

      {updateMutation.isError && (
        <div className="rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
          Failed to update user.
        </div>
      )}

      <div className="flex justify-end border-t border-line pt-4">
        <button
          type="submit"
          disabled={updateMutation.isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
