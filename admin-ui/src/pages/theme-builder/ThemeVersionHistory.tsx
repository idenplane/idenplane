import { useState, useEffect, useCallback } from 'react';
import type { ThemeVersion } from '../../types/theme';
import { getThemeVersions } from '../../api/themes';

interface ThemeVersionHistoryProps {
  themeId: string;
  realmName: string;
  onRollback?: (version: ThemeVersion) => void;
  currentVersion?: number;
  loading?: boolean;
}

export default function ThemeVersionHistory({
  themeId,
  realmName,
  onRollback,
  currentVersion,
  loading: externalLoading,
}: ThemeVersionHistoryProps) {
  const [versions, setVersions] = useState<ThemeVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    if (!themeId) return;

    setLoading(true);
    setError(null);

    try {
      const data = await getThemeVersions(realmName, themeId);
      setVersions(data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load version history';
      setError(message);
      console.error('Error fetching theme versions:', err);
    } finally {
      setLoading(false);
    }
  }, [themeId, realmName]);

  // Fetch the version history on mount and whenever the target theme changes.
  // This is a genuine "synchronize with an external system" effect; the
  // synchronous setLoading/setError inside fetchVersions are the start of an
  // async data load, not derived state, so the rule's warning does not apply.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchVersions();
  }, [fetchVersions]);

  const handleRollback = async (version: ThemeVersion) => {
    if (!onRollback) return;

    setRollingBackId(version.id);
    try {
      await onRollback(version);
      // Refresh the version list after rollback
      await fetchVersions();
    } finally {
      setRollingBackId(null);
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  };

  const formatFullDate = (timestamp: string): string => {
    return new Date(timestamp).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const isLoading = externalLoading || loading;

  if (isLoading && versions.length === 0) {
    return (
      <div className="flex h-full flex-col bg-white" data-testid="theme-version-history">
        {/* Header */}
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Version History</h2>
          <p className="mt-1 text-sm text-gray-500">
            View and restore previous versions
          </p>
        </div>

        {/* Loading state */}
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-600" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col bg-white" data-testid="theme-version-history">
        {/* Header */}
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Version History</h2>
          <p className="mt-1 text-sm text-gray-500">
            View and restore previous versions
          </p>
        </div>

        {/* Error state */}
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <div className="rounded-lg bg-red-50 p-4 text-center">
            <svg
              className="mx-auto h-10 w-10 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <p className="mt-2 text-sm text-red-600">{error}</p>
            <button
              onClick={fetchVersions}
              className="mt-3 rounded-md bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white" data-testid="theme-version-history">
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3">
        <h2 className="text-base font-semibold text-gray-900">Version History</h2>
        <p className="mt-1 text-sm text-gray-500">
          View and restore previous versions
        </p>
      </div>

      {/* Version list */}
      <div className="flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg
              className="h-12 w-12 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="mt-2 text-sm text-gray-500">No version history yet</p>
            <p className="mt-1 text-xs text-gray-400">
              Versions are created when you publish changes
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {versions.map((version, index) => {
              const isCurrent = currentVersion !== undefined && version.version === currentVersion;
              const isRollingBack = rollingBackId === version.id;

              return (
                <div
                  key={version.id}
                  className={`p-4 transition-colors ${
                    isCurrent ? 'bg-indigo-50' : 'hover:bg-gray-50'
                  }`}
                  data-testid={`version-item-${version.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {/* Version badge */}
                      <div className="flex flex-col items-center">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-full ${
                            isCurrent
                              ? 'bg-indigo-600 text-white'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          <span className="text-sm font-semibold">
                            v{version.version}
                          </span>
                        </div>
                        {index < versions.length - 1 && (
                          <div className="h-4 w-0.5 bg-gray-200" />
                        )}
                      </div>

                      {/* Version details */}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium text-gray-900">
                            Version {version.version}
                          </h3>
                          {isCurrent && (
                            <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                              Current
                            </span>
                          )}
                        </div>

                        {version.changes && (
                          <p className="mt-1 text-sm text-gray-600">
                            {version.changes}
                          </p>
                        )}

                        <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                          <span
                            className="flex items-center gap-1"
                            title={formatFullDate(version.createdAt)}
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            {formatTimestamp(version.createdAt)}
                          </span>

                          {version.createdBy && (
                            <span className="flex items-center gap-1">
                              <svg
                                className="h-3.5 w-3.5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                />
                              </svg>
                              {version.createdBy}
                            </span>
                          )}
                        </div>

                        {/* Changes summary */}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span
                            className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                            title="Styles changed"
                          >
                            <svg
                              className="mr-1 h-3 w-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                              />
                            </svg>
                            Styles
                          </span>
                          <span
                            className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                            title="Components changed"
                          >
                            <svg
                              className="mr-1 h-3 w-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                              />
                            </svg>
                            {version.components?.length || 0} components
                          </span>
                          <span
                            className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                            title="Settings changed"
                          >
                            <svg
                              className="mr-1 h-3 w-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                            Settings
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    {!isCurrent && onRollback && (
                      <button
                        onClick={() => handleRollback(version)}
                        disabled={isRollingBack || rollingBackId !== null}
                        className={`mt-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                          isRollingBack
                            ? 'bg-gray-100 text-gray-400'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        } disabled:cursor-not-allowed`}
                        data-testid={`rollback-button-${version.id}`}
                      >
                        {isRollingBack ? (
                          <span className="flex items-center gap-1.5">
                            <div className="h-3.5 w-3.5 animate-spin rounded-full border border-white border-t-transparent" />
                            Restoring...
                          </span>
                        ) : (
                          'Restore'
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with refresh */}
      <div className="border-t border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {versions.length} version{versions.length === 1 ? '' : 's'} saved
          </p>
          <button
            onClick={fetchVersions}
            disabled={loading}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="refresh-versions"
          >
            <svg
              className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
