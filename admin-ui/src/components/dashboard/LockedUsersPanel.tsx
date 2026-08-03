import { useQuery } from '@tanstack/react-query';
import { getLockedUsers } from '../../api/bruteForce';
import { Card, Icons } from '../ui';

interface LockedUsersPanelProps {
  realmName: string;
}

function formatRemaining(lockedUntil: string): string {
  const ms = new Date(lockedUntil).getTime() - Date.now();
  if (ms <= 0) return 'expiring now';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m remaining`;
  const hours = Math.round(minutes / 60);
  return `${hours}h remaining`;
}

export default function LockedUsersPanel({ realmName }: LockedUsersPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['lockedUsers', realmName],
    queryFn: () => getLockedUsers(realmName),
    staleTime: 30_000,
    // Lockouts expire on their own — refresh often enough that a cleared
    // one doesn't linger on the dashboard for minutes after it's stale.
    refetchInterval: 30_000,
  });

  return (
    <div>
      <h2 className="mb-3 text-base font-semibold text-fg">Locked Out Accounts</h2>
      <Card padding="sm">
        {isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-sunken" />
        ) : !data || data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No accounts are currently locked out.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((user) => (
              <li key={user.id} className="flex items-center gap-3 py-2.5">
                <Icons.Lock className="h-4 w-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{user.username}</p>
                  {user.email && <p className="truncate text-xs text-subtle">{user.email}</p>}
                </div>
                <span className="shrink-0 text-xs font-medium text-danger-fg">
                  {formatRemaining(user.lockedUntil)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
