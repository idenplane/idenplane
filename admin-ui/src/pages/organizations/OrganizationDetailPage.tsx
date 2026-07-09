import { useState, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOrganization,
  updateOrganization,
  deleteOrganization,
  getOrgMembers,
  addOrgMember,
  updateOrgMember,
  removeOrgMember,
  getOrgInvitations,
  createOrgInvitation,
} from '../../api/organizations';
import type { OrgMember } from '../../api/organizations';
import ConfirmDialog from '../../components/ConfirmDialog';

type OrgRole = 'owner' | 'admin' | 'member';

function RoleBadge({ role }: { role: OrgRole }) {
  const classes: Record<OrgRole, string> = {
    owner: 'bg-purple-100 text-purple-700',
    admin: 'bg-blue-100 text-blue-700',
    member: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${classes[role]}`}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

const INPUT_CLS =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none';

const ROLE_SELECT_CLS =
  'rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none';

export default function OrganizationDetailPage() {
  const { name, slug } = useParams<{ name: string; slug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showDelete, setShowDelete] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [pendingRoles, setPendingRoles] = useState<Record<string, OrgRole>>({});
  const [addForm, setAddForm] = useState({ userId: '', role: 'member' as OrgRole });
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' as OrgRole });

  const { data: org, isLoading } = useQuery({
    queryKey: ['organization', name, slug],
    queryFn: () => getOrganization(name!, slug!),
    enabled: !!name && !!slug,
  });

  const { data: members } = useQuery({
    queryKey: ['org-members', name, slug],
    queryFn: () => getOrgMembers(name!, slug!),
    enabled: !!name && !!slug,
  });

  const { data: invitations } = useQuery({
    queryKey: ['org-invitations', name, slug],
    queryFn: () => getOrgInvitations(name!, slug!),
    enabled: !!name && !!slug,
  });

  const [form, setForm] = useState({
    name: '',
    displayName: '',
    description: '',
    logoUrl: '',
    primaryColor: '#6366f1',
    requireMfa: false,
    enabled: true,
  });

  const [seededOrg, setSeededOrg] = useState(org);
  if (org && org !== seededOrg) {
    setSeededOrg(org);
    setForm({
      name: org.name,
      displayName: org.displayName ?? '',
      description: org.description ?? '',
      logoUrl: org.logoUrl ?? '',
      primaryColor: org.primaryColor ?? '#6366f1',
      requireMfa: org.requireMfa,
      enabled: org.enabled,
    });
  }

  const [seededMembers, setSeededMembers] = useState<OrgMember[] | undefined>(members);
  if (members && members !== seededMembers) {
    setSeededMembers(members);
    const roles: Record<string, OrgRole> = {};
    for (const m of members) {
      roles[m.userId] = m.role;
    }
    setPendingRoles(roles);
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      updateOrganization(name!, slug!, {
        name: form.name,
        displayName: form.displayName || undefined,
        description: form.description || undefined,
        logoUrl: form.logoUrl || undefined,
        primaryColor: form.primaryColor || undefined,
        requireMfa: form.requireMfa,
        enabled: form.enabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', name, slug] });
      queryClient.invalidateQueries({ queryKey: ['organizations', name] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteOrganization(name!, slug!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', name] });
      navigate(`/console/realms/${name}/organizations`);
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: () =>
      addOrgMember(name!, slug!, { userId: addForm.userId, role: addForm.role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', name, slug] });
      setAddForm({ userId: '', role: 'member' });
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      updateOrgMember(name!, slug!, userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', name, slug] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeOrgMember(name!, slug!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members', name, slug] });
      setRemovingMemberId(null);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      createOrgInvitation(name!, slug!, { email: inviteForm.email, role: inviteForm.role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-invitations', name, slug] });
      setInviteForm({ email: '', role: 'member' });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    updateMutation.mutate();
  }

  function handleAddMember(e: FormEvent) {
    e.preventDefault();
    addMemberMutation.mutate();
  }

  function handleInvite(e: FormEvent) {
    e.preventDefault();
    inviteMutation.mutate();
  }

  const set = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  if (isLoading) {
    return <div className="text-gray-500">Loading organization...</div>;
  }

  if (!org) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
        Organization not found.
      </div>
    );
  }

  const memberToRemove = members?.find((m) => m.userId === removingMemberId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{org.name}</h1>
          {org.displayName && (
            <p className="mt-1 text-sm text-gray-500">{org.displayName}</p>
          )}
        </div>
        <button
          onClick={() => setShowDelete(true)}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      </div>

      {/* Settings */}
      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Settings</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="field-org-slug" className="mb-1.5 block text-sm font-medium text-gray-700">Slug</label>
            <input
              id="field-org-slug"
              type="text"
              value={org.slug}
              disabled
              className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
            />
          </div>
          <div>
            <label htmlFor="field-org-name" className="mb-1.5 block text-sm font-medium text-gray-700">Name *</label>
            <input
              id="field-org-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="field-org-displayName" className="mb-1.5 block text-sm font-medium text-gray-700">Display Name</label>
            <input
              id="field-org-displayName"
              type="text"
              value={form.displayName}
              onChange={(e) => set('displayName', e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label htmlFor="field-org-logoUrl" className="mb-1.5 block text-sm font-medium text-gray-700">Logo URL</label>
            <input
              id="field-org-logoUrl"
              type="url"
              value={form.logoUrl}
              onChange={(e) => set('logoUrl', e.target.value)}
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div>
          <label htmlFor="field-org-description" className="mb-1.5 block text-sm font-medium text-gray-700">Description</label>
          <textarea
            id="field-org-description"
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            className={INPUT_CLS}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="field-org-primaryColor" className="mb-1.5 block text-sm font-medium text-gray-700">Primary Color</label>
            <input
              id="field-org-primaryColor"
              type="color"
              value={form.primaryColor}
              onChange={(e) => set('primaryColor', e.target.value)}
              className="h-10 w-full cursor-pointer rounded-md border border-gray-300 px-1 py-1"
            />
          </div>
          <div className="space-y-3 pt-6">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                id="field-org-requireMfa"
                checked={form.requireMfa}
                onChange={(e) => set('requireMfa', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-medium text-gray-700">Require MFA</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                id="field-org-enabled"
                checked={form.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-medium text-gray-700">Enabled</span>
            </label>
          </div>
        </div>

        {updateMutation.isSuccess && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
            Organization updated successfully.
          </div>
        )}
        {updateMutation.isError && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Failed to update organization.
          </div>
        )}

        <div className="flex justify-end border-t border-gray-200 pt-4">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Members */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Members</h2>
        </div>

        {members && members.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Username</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {members.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                      {member.user?.username ?? member.userId}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {member.user?.email ?? '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <RoleBadge role={member.role} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-2">
                        <select
                          value={pendingRoles[member.userId] ?? member.role}
                          onChange={(e) =>
                            setPendingRoles((r) => ({
                              ...r,
                              [member.userId]: e.target.value as OrgRole,
                            }))
                          }
                          className={ROLE_SELECT_CLS}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                          <option value="owner">Owner</option>
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            updateMemberMutation.mutate({
                              userId: member.userId,
                              role: pendingRoles[member.userId] ?? member.role,
                            })
                          }
                          disabled={updateMemberMutation.isPending}
                          className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemovingMemberId(member.userId)}
                          className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-8 text-center text-sm text-gray-500">No members yet.</div>
        )}

        <div className="border-t border-gray-200 px-6 py-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Add Member</h3>
          <form onSubmit={handleAddMember} className="flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor="field-add-userId" className="mb-1 block text-xs font-medium text-gray-600">
                User ID
              </label>
              <input
                id="field-add-userId"
                type="text"
                required
                value={addForm.userId}
                onChange={(e) => setAddForm((f) => ({ ...f, userId: e.target.value }))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="field-add-role" className="mb-1 block text-xs font-medium text-gray-600">
                Role
              </label>
              <select
                id="field-add-role"
                value={addForm.role}
                onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value as OrgRole }))}
                className={ROLE_SELECT_CLS}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={addMemberMutation.isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {addMemberMutation.isPending ? 'Adding...' : 'Add'}
            </button>
          </form>
          {addMemberMutation.isError && (
            <div className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
              Failed to add member.
            </div>
          )}
        </div>
      </div>

      {/* Invitations */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Invitations</h2>
        </div>

        {invitations && invitations.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invitations.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{inv.email}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <RoleBadge role={inv.role} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      {inv.acceptedAt ? (
                        <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Accepted
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-8 text-center text-sm text-gray-500">No invitations yet.</div>
        )}

        <div className="border-t border-gray-200 px-6 py-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Invite User</h3>
          <form onSubmit={handleInvite} className="flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor="field-invite-email" className="mb-1 block text-xs font-medium text-gray-600">
                Email
              </label>
              <input
                id="field-invite-email"
                type="email"
                required
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label htmlFor="field-invite-role" className="mb-1 block text-xs font-medium text-gray-600">
                Role
              </label>
              <select
                id="field-invite-role"
                value={inviteForm.role}
                onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as OrgRole }))}
                className={ROLE_SELECT_CLS}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={inviteMutation.isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {inviteMutation.isPending ? 'Sending...' : 'Send'}
            </button>
          </form>
          {inviteMutation.isError && (
            <div className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
              Failed to send invitation.
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDelete}
        title="Delete Organization"
        message={`Are you sure you want to delete organization "${org.name}"? This action cannot be undone.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDelete(false)}
      />

      <ConfirmDialog
        isOpen={!!removingMemberId}
        title="Remove Member"
        message={`Are you sure you want to remove ${memberToRemove?.user?.username ?? removingMemberId} from this organization?`}
        onConfirm={() => {
          if (removingMemberId) removeMemberMutation.mutate(removingMemberId);
        }}
        onCancel={() => setRemovingMemberId(null)}
      />
    </div>
  );
}
