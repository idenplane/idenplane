import { useState } from 'react'
import { useParams } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getLoginEvents, clearLoginEvents, type LoginEvent } from '../../api/events'
import ConfirmDialog from '../../components/ConfirmDialog'

const EVENT_TYPES = [
  'LOGIN',
  'LOGIN_ERROR',
  'LOGOUT',
  'TOKEN_REFRESH',
  'TOKEN_REFRESH_ERROR',
  'CODE_TO_TOKEN',
  'CLIENT_LOGIN',
  'MFA_VERIFY',
  'MFA_VERIFY_ERROR',
  'DEVICE_CODE_TO_TOKEN',
] as const

type EventType = (typeof EVENT_TYPES)[number]

const SUCCESS_TYPES: EventType[] = [
  'LOGIN',
  'TOKEN_REFRESH',
  'CODE_TO_TOKEN',
  'CLIENT_LOGIN',
  'LOGOUT',
  'MFA_VERIFY',
  'DEVICE_CODE_TO_TOKEN',
]

const ERROR_TYPES: EventType[] = [
  'LOGIN_ERROR',
  'TOKEN_REFRESH_ERROR',
  'MFA_VERIFY_ERROR',
]

function getTypeBadgeClasses(type: string): string {
  if (SUCCESS_TYPES.includes(type as EventType)) {
    return 'inline-flex items-center rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success-fg'
  }
  if (ERROR_TYPES.includes(type as EventType)) {
    return 'inline-flex items-center rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-medium text-danger-fg'
  }
  return 'inline-flex items-center rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-fg'
}

export default function LoginEventsPage() {
  const { name } = useParams<{ name: string }>()
  const queryClient = useQueryClient()

  const [filterType, setFilterType] = useState<string>('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const {
    data: events,
    isLoading,
    isError,
    error,
  } = useQuery<LoginEvent[]>({
    queryKey: ['loginEvents', name, filterType],
    queryFn: () =>
      getLoginEvents(name!, { type: filterType || undefined }),
    enabled: !!name,
    refetchInterval: 30000,
  })

  const clearMutation = useMutation({
    mutationFn: () => clearLoginEvents(name!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loginEvents', name] })
    },
  })

  const handleClearEvents = () => {
    setShowClearConfirm(true)
  }

  const handleClearConfirmed = () => {
    setShowClearConfirm(false)
    clearMutation.mutate()
  }

  const handleClearFilters = () => {
    setFilterType('')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg">Login Events</h1>
          <p className="mt-1 text-sm text-subtle">
            View login events for realm <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleClearEvents}
          disabled={clearMutation.isPending}
          className="inline-flex items-center rounded-md border border-danger-soft bg-surface px-4 py-2 text-sm font-medium text-danger-fg shadow-sm hover:bg-danger-soft focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {clearMutation.isPending ? 'Clearing...' : 'Clear Events'}
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-4 rounded-md border bg-surface p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <label htmlFor="event-type-filter" className="text-sm font-medium text-muted">
            Event Type
          </label>
          <select
            id="event-type-filter"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Types</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        {filterType && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="inline-flex items-center rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-muted shadow-sm hover:bg-hover focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center rounded-md border bg-surface py-12" aria-busy="true" aria-label="Loading login events">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" aria-hidden="true" />
            <p className="mt-3 text-sm text-subtle">Loading login events...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="rounded-md border border-danger-soft bg-danger-soft p-4"
        >
          <div className="flex">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-danger-fg">Failed to load login events</h3>
              <p className="mt-1 text-sm text-danger-fg">
                {error instanceof Error ? error.message : 'An unexpected error occurred.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && events && events.length === 0 && (
        <div className="flex items-center justify-center rounded-md border bg-surface py-12">
          <div className="text-center">
            <p className="text-sm font-medium text-fg">No login events found</p>
            <p className="mt-1 text-sm text-subtle">
              {filterType
                ? 'Try adjusting your filters to see more results.'
                : 'Login events will appear here when users authenticate.'}
            </p>
          </div>
        </div>
      )}

      {/* Events Table */}
      {!isLoading && !isError && events && events.length > 0 && (
        <div className="overflow-hidden rounded-md border bg-surface shadow-sm">
          <table className="min-w-full divide-y divide-line">
            <thead className="bg-sunken">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                >
                  Time
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                >
                  Type
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                >
                  User ID
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                >
                  Client ID
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                >
                  IP Address
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle"
                >
                  Error
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-surface">
              {events.map((event, index) => (
                <tr key={`${event.createdAt}-${event.userId}-${index}`} className="hover:bg-hover">
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-fg">
                    {new Date(event.createdAt).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span className={getTypeBadgeClasses(event.type)}>{event.type}</span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle font-mono">
                    {event.userId || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {event.clientId || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle font-mono">
                    {event.ipAddress || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-danger">
                    {event.error || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Clear Login Events"
        message="Are you sure you want to clear all login events? This action cannot be undone."
        onConfirm={handleClearConfirmed}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  )
}
