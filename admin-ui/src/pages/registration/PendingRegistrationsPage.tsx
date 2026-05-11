import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPendingRegistrations, approveRegistration, rejectRegistration } from '../../api/registration';
import ConfirmDialog from '../../components/ConfirmDialog';

export default function PendingRegistrationsPage() {
  const { name } = useParams<{ name: string }>();
  const queryClient = useQueryClient();
  const [rejectReason, setRejectReason] = useState('');
  const [pendingReject, setPendingReject] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['pending-registrations', name],
    queryFn: () => getPendingRegistrations(name!),
    enabled: !!name,
  });

  const approveMutation = useMutation({
    mutationFn: (userId: string) => approveRegistration(name!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-registrations', name] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (userId: string) => rejectRegistration(name!, userId, rejectReason || undefined),
    onSuccess: () => {
      setPendingReject(null);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['pending-registrations', name] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        Failed to load pending registrations: {(error as Error).message}
      </div>
    );
  }

  const { users = [], total = 0 } = data || {};

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pending Registrations</h1>
          <p className="mt-1 text-sm text-gray-500">
            {total} pending approval{total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No pending registrations</h3>
          <p className="mt-1 text-sm text-gray-500">All caught up!</p>
        </div>
      ) : (
        <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Username
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Registered
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{user.username}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-500">{user.email || '—'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-500">
                      {[user.firstName, user.lastName].filter(Boolean).join(' ') || '—'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => approveMutation.mutate(user.id)}
                      disabled={approveMutation.isPending}
                      className="text-green-600 hover:text-green-900 mr-4 disabled:opacity-50"
                    >
                      {approveMutation.isPending && approveMutation.variables === user.id ? 'Approving...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => setPendingReject(user.id)}
                      disabled={rejectMutation.isPending}
                      className="text-red-600 hover:text-red-900 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={pendingReject !== null}
        onClose={() => setPendingReject(null)}
        onConfirm={() => pendingReject && rejectMutation.mutate(pendingReject)}
        title="Reject Registration"
        message={
          <div className="space-y-3">
            <p>Are you sure you want to reject this registration? This action cannot be undone.</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500"
                rows={3}
                placeholder="Provide a reason for the rejection..."
              />
            </div>
          </div>
        }
        confirmText={rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
        confirmDisabled={rejectMutation.isPending}
      />
    </div>
  );
}