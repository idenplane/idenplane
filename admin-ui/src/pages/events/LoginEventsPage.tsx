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
    return 'inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800'
  }
  if (ERROR_TYPES.includes(type as EventType)) {
    return 'inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800'
  }
  return 'inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800'
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
          <h1 className="text-2xl font-semibold text-gray-900">Login Events</h1>
          <p className="mt-1 text-sm text-gray-500">
            View login events for realm <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleClearEvents}
          disabled={clearMutation.isPending}
          className="inline-flex items-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {clearMutation.isPending ? 'Clearing...' : 'Clear Events'}
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-4 rounded-md border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <label htmlFor="event-type-filter" className="text-sm font-medium text-gray-700">
            Event Type
          </label>
          <select
            id="event-type-filter"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center rounded-md border bg-white py-12" aria-busy="true" aria-label="Loading login events">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" aria-hidden="true" />
            <p className="mt-3 text-sm text-gray-500">Loading login events...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="rounded-md border border-red-200 bg-red-50 p-4"
        >
          <div className="flex">
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Failed to load login events</h3>
              <p className="mt-1 text-sm text-red-700">
                {error instanceof Error ? error.message : 'An unexpected error occurred.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && events && events.length === 0 && (
        <div className="flex items-center justify-center rounded-md border bg-white py-12">
          <div className="text-center">
            <p className="text-sm font-medium text-gray-900">No login events found</p>
            <p className="mt-1 text-sm text-gray-500">
              {filterType
                ? 'Try adjusting your filters to see more results.'
                : 'Login events will appear here when users authenticate.'}
            </p>
          </div>
        </div>
      )}

      {/* Events Table */}
      {!isLoading && !isError && events && events.length > 0 && (
        <div className="overflow-hidden rounded-md border bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  Time
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  Type
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  User ID
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  Client ID
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  IP Address
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  Error
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {events.map((event, index) => (
                <tr key={`${event.createdAt}-${event.userId}-${index}`} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                    {new Date(event.createdAt).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span className={getTypeBadgeClasses(event.type)}>{event.type}</span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 font-mono">
                    {event.userId || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {event.clientId || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 font-mono">
                    {event.ipAddress || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-red-600">
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
