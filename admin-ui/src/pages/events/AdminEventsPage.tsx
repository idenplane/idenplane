import { useState, Fragment } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { getAdminEvents } from '../../api/events'

const OPERATION_TYPES = ['CREATE', 'UPDATE', 'DELETE'] as const
const RESOURCE_TYPES = ['USER', 'CLIENT', 'REALM', 'ROLE', 'GROUP', 'SCOPE', 'IDP'] as const

function formatDate(date: string) {
  return new Date(date).toLocaleString()
}

function operationBadgeClasses(operation: string): string {
  switch (operation) {
    case 'CREATE':
      return 'bg-green-100 text-green-700'
    case 'UPDATE':
      return 'bg-amber-100 text-amber-700'
    case 'DELETE':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

export default function AdminEventsPage() {
  const { name } = useParams<{ name: string }>()

  const [operationType, setOperationType] = useState('')
  const [resourceType, setResourceType] = useState('')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const { data: events, isLoading, isError, error } = useQuery({
    queryKey: ['admin-events', name, operationType, resourceType],
    queryFn: () =>
      getAdminEvents(name!, {
        operationType: operationType || undefined,
        resourceType: resourceType || undefined,
      }),
    enabled: !!name,
    refetchInterval: 30000,
  })

  const clearFilters = () => {
    setOperationType('')
    setResourceType('')
  }

  const hasFilters = operationType !== '' || resourceType !== ''

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Admin Events</h1>
        <span className="text-sm text-gray-500">
          {events?.length ?? 0} event{events?.length !== 1 ? 's' : ''}
          <span className="ml-2 text-gray-400">Auto-refreshes every 30s</span>
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <label htmlFor="operationType" className="text-sm font-medium text-gray-700">
            Operation
          </label>
          <select
            id="operationType"
            value={operationType}
            onChange={(e) => setOperationType(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All</option>
            {OPERATION_TYPES.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="resourceType" className="text-sm font-medium text-gray-700">
            Resource
          </label>
          <select
            id="resourceType"
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All</option>
            {RESOURCE_TYPES.map((rt) => (
              <option key={rt} value={rt}>
                {rt}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 shadow-sm hover:bg-gray-50"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading admin events...</div>
        </div>
      ) : isError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-8 text-center text-red-600">
          Failed to load admin events.{' '}
          {error instanceof Error ? error.message : 'An unexpected error occurred.'}
        </div>
      ) : !events || events.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          No admin events found.
          {hasFilters && ' Try clearing the filters.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Operation
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Resource Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Resource Path
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Admin User ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  IP Address
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {events.map((event) => (
                <Fragment key={event.id}>
                  <tr
                    onClick={() =>
                      setExpandedRow(expandedRow === event.id ? null : event.id)
                    }
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {formatDate(event.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${operationBadgeClasses(event.operationType)}`}
                      >
                        {event.operationType}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                      {event.resourceType}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500" title={event.resourcePath}>
                      <span className="block max-w-xs truncate">{event.resourcePath}</span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-mono text-gray-500">
                      {event.adminUserId}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {event.ipAddress || '-'}
                    </td>
                  </tr>
                  {expandedRow === event.id && (
                    <tr key={`${event.id}-detail`}>
                      <td colSpan={6} className="px-6 py-4">
                        <div className="rounded-md border border-gray-200">
                          <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-100 rounded-t-md">
                            Event Representation
                          </div>
                          <pre className="overflow-x-auto bg-gray-50 p-4 text-xs text-gray-800 rounded-b-md">
                            {event.representation
                              ? JSON.stringify(event.representation, null, 2)
                              : 'No representation data available.'}
                          </pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
