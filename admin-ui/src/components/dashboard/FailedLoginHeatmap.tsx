import { useQuery } from '@tanstack/react-query';
import { getFailedLoginHeatmap } from '../../api/stats';
import { Card } from '../ui';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_MARKERS = [0, 6, 12, 18];

interface FailedLoginHeatmapProps {
  realmName: string;
}

export default function FailedLoginHeatmap({ realmName }: FailedLoginHeatmapProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['failedLoginHeatmap', realmName],
    queryFn: () => getFailedLoginHeatmap(realmName),
    staleTime: 60_000,
  });

  return (
    <div>
      <h2 className="mb-3 text-base font-semibold text-fg">Failed Logins by Time of Day</h2>
      <Card padding="sm">
        {isLoading ? (
          <div className="h-40 animate-pulse rounded-md bg-sunken" />
        ) : !data || data.totalFailures === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No failed logins in the last {data?.windowDays ?? 30} days.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              {/* Hour axis */}
              <div
                className="ml-10 mb-1 grid text-[10px] text-subtle"
                style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <span key={hour} className="text-center">
                    {HOUR_MARKERS.includes(hour) ? hour : ''}
                  </span>
                ))}
              </div>

              {data.heatmap.map((row, day) => {
                const max = Math.max(1, ...data.heatmap.flat());
                return (
                  <div key={day} className="flex items-center gap-0">
                    <span className="w-10 shrink-0 text-[11px] font-medium text-subtle">
                      {DAY_LABELS[day]}
                    </span>
                    <div
                      className="grid flex-1 gap-px"
                      style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
                    >
                      {row.map((count, hour) => (
                        <div
                          key={hour}
                          role="img"
                          aria-label={`${DAY_LABELS[day]} ${hour}:00 UTC: ${count} failed login${count === 1 ? '' : 's'}`}
                          title={`${DAY_LABELS[day]} ${hour}:00 UTC — ${count} failed login${count === 1 ? '' : 's'}`}
                          className="aspect-square rounded-[2px] bg-danger"
                          style={{ opacity: count === 0 ? 0.06 : 0.15 + 0.85 * (count / max) }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              <p className="mt-3 text-xs text-subtle">
                {data.totalFailures} failed login{data.totalFailures === 1 ? '' : 's'} in the last{' '}
                {data.windowDays} days, bucketed by hour (UTC).
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
