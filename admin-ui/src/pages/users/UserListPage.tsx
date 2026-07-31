import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { getUsers } from '../../api/users';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { SectionHeader, Button, Card, Badge, Alert, EmptyState, Icons, cn } from '../../components/ui';

const PAGE_SIZE = 20;

export default function UserListPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isLoading, error, isPlaceholderData } = useQuery({
    queryKey: ['users', name, page],
    queryFn: () => getUsers(name!, page, PAGE_SIZE),
    enabled: !!name,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading users...</div>
      </div>
    );
  }

  if (error) {
    return <Alert variant="danger">{getErrorMessage(error, 'Failed to load users.')}</Alert>;
  }

  return (
    <div>
      <SectionHeader
        title="Users"
        hint={
          <>
            Manage users in <span className="font-medium">{name}</span>
            {total > 0 && ` (${total} total)`}
          </>
        }
        action={
          <Button
            icon={Icons.Plus}
            onClick={() => navigate(`/console/realms/${name}/users/create`)}
          >
            Create User
          </Button>
        }
      />

      <Card padding="none">
        <table className="min-w-full divide-y divide-line" aria-label="Users">
          <thead className="bg-sunken">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Username
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Email
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Name
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Enabled
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Created
              </th>
            </tr>
          </thead>
          <tbody
            className={cn('divide-y divide-line', isPlaceholderData && 'opacity-60')}
            aria-busy={isPlaceholderData}
          >
            {users.length > 0 ? (
              users.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => navigate(`/console/realms/${name}/users/${user.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/console/realms/${name}/users/${user.id}`);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`View user ${user.username}`}
                  className="cursor-pointer hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-accent">
                    {user.username}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                    {user.email}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                    {[user.firstName, user.lastName].filter(Boolean).join(' ') || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <Badge variant={user.enabled ? 'success' : 'neutral'} size="sm">
                      {user.enabled ? 'Yes' : 'No'}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="p-0">
                  <EmptyState icon={Icons.Users} title="No users found in this realm." />
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <nav
            aria-label="Users pagination"
            className="flex items-center justify-between border-t border-line px-6 py-3"
          >
            <p className="text-sm text-muted" aria-live="polite" aria-atomic="true">
              Showing{' '}
              <span className="font-medium">{(page - 1) * PAGE_SIZE + 1}</span>
              {' '}&ndash;{' '}
              <span className="font-medium">{Math.min(page * PAGE_SIZE, total)}</span>
              {' '}of{' '}
              <span className="font-medium">{total}</span> users
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </nav>
        )}
      </Card>
    </div>
  );
}
