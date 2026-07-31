import { useState, type FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getClientScopeById, updateClientScope, deleteClientScope, addMapper, deleteMapper } from '../../api/clientScopes'
import ConfirmDialog from '../../components/ConfirmDialog'

export default function ClientScopeDetailPage() {
  const { name, scopeId } = useParams<{ name: string; scopeId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [form, setForm] = useState({ name: '', description: '' })
  const [mapperForm, setMapperForm] = useState({
    name: '',
    mapperType: 'oidc-usermodel-attribute-mapper',
    config: '{}'
  })
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showDeleteMapperDialog, setShowDeleteMapperDialog] = useState(false)
  const [mapperToDelete, setMapperToDelete] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const { data: scope, isLoading } = useQuery({
    queryKey: ['clientScope', name, scopeId],
    queryFn: () => getClientScopeById(name!, scopeId!),
    enabled: !!name && !!scopeId
  })

  // Seed the editable form from fetched data when the loaded scope changes.
  // Adjusting state during render (vs. an effect) avoids an extra render pass.
  const [seededScope, setSeededScope] = useState(scope)
  if (scope && scope !== seededScope) {
    setSeededScope(scope)
    setForm({ name: scope.name, description: scope.description || '' })
  }

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      updateClientScope(name!, scopeId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientScope', name, scopeId] })
      queryClient.invalidateQueries({ queryKey: ['clientScopes', name] })
      setSuccessMessage('Client scope updated successfully')
      setErrorMessage('')
      setTimeout(() => setSuccessMessage(''), 3000)
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Failed to update client scope')
      setSuccessMessage('')
    }
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteClientScope(name!, scopeId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientScopes', name] })
      navigate(`/console/realms/${name}/client-scopes`)
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Failed to delete client scope')
      setSuccessMessage('')
      setShowDeleteDialog(false)
    }
  })

  const addMapperMutation = useMutation({
    mutationFn: (data: { name: string; mapperType: string; config: Record<string, unknown> }) =>
      addMapper(name!, scopeId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientScope', name, scopeId] })
      setMapperForm({ name: '', mapperType: 'oidc-usermodel-attribute-mapper', config: '{}' })
      setSuccessMessage('Mapper added successfully')
      setErrorMessage('')
      setTimeout(() => setSuccessMessage(''), 3000)
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Failed to add mapper')
      setSuccessMessage('')
    }
  })

  const deleteMapperMutation = useMutation({
    mutationFn: (mapperId: string) => deleteMapper(name!, scopeId!, mapperId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clientScope', name, scopeId] })
      setSuccessMessage('Mapper deleted successfully')
      setErrorMessage('')
      setShowDeleteMapperDialog(false)
      setMapperToDelete(null)
      setTimeout(() => setSuccessMessage(''), 3000)
    },
    onError: (error: Error) => {
      setErrorMessage(error.message || 'Failed to delete mapper')
      setSuccessMessage('')
      setShowDeleteMapperDialog(false)
      setMapperToDelete(null)
    }
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    updateMutation.mutate({ name: form.name, description: form.description })
  }

  const handleAddMapper = (e: FormEvent) => {
    e.preventDefault()
    try {
      const config = JSON.parse(mapperForm.config)
      addMapperMutation.mutate({
        name: mapperForm.name,
        mapperType: mapperForm.mapperType,
        config
      })
    } catch {
      setErrorMessage('Invalid JSON in config field')
      setSuccessMessage('')
    }
  }

  const handleDeleteMapper = (mapperId: string) => {
    setMapperToDelete(mapperId)
    setShowDeleteMapperDialog(true)
  }

  const confirmDeleteMapper = () => {
    if (mapperToDelete) {
      deleteMapperMutation.mutate(mapperToDelete)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading...</div>
      </div>
    )
  }

  if (!scope) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Client scope not found</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-fg">{scope.name}</h1>
          {scope.builtIn && (
            <span className="rounded-full bg-success-soft px-3 py-1 text-xs font-medium text-success-fg">
              Built-in
            </span>
          )}
        </div>
        <button
          onClick={() => setShowDeleteDialog(true)}
          disabled={scope.builtIn}
          className="rounded-md border border-danger-soft px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger-soft disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="rounded-md bg-success-soft p-4">
          <p className="text-sm text-success-fg">{successMessage}</p>
        </div>
      )}
      {errorMessage && (
        <div className="rounded-md bg-danger-soft p-4">
          <p className="text-sm text-danger-fg">{errorMessage}</p>
        </div>
      )}

      {/* Settings Form */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Settings</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-muted">
              Name
            </label>
            <input
              type="text"
              id="name"
              disabled={scope.builtIn}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:opacity-50"
            />
          </div>
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-muted">
              Description
            </label>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>

      {/* Protocol Mappers Section */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-fg">Protocol Mappers</h2>

        {/* Existing Mappers Table */}
        {scope.protocolMappers && scope.protocolMappers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-sunken">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                    Type
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-subtle">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-surface">
                {scope.protocolMappers.map((mapper) => (
                  <tr key={mapper.id}>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-fg">
                      {mapper.name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                      {mapper.mapperType}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                      <button
                        onClick={() => handleDeleteMapper(mapper.id)}
                        className="text-danger hover:text-danger-fg"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-subtle">No protocol mappers configured</p>
        )}

        {/* Add Mapper Form */}
        <div className="border-t border-line pt-4">
          <h3 className="mb-4 text-base font-medium text-fg">Add Mapper</h3>
          <form onSubmit={handleAddMapper} className="space-y-4">
            <div>
              <label htmlFor="mapperName" className="block text-sm font-medium text-muted">
                Name
              </label>
              <input
                type="text"
                id="mapperName"
                value={mapperForm.name}
                onChange={(e) => setMapperForm({ ...mapperForm, name: e.target.value })}
                required
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="mapperType" className="block text-sm font-medium text-muted">
                Mapper Type
              </label>
              <select
                id="mapperType"
                value={mapperForm.mapperType}
                onChange={(e) => setMapperForm({ ...mapperForm, mapperType: e.target.value })}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="oidc-usermodel-attribute-mapper">oidc-usermodel-attribute-mapper</option>
                <option value="oidc-hardcoded-claim-mapper">oidc-hardcoded-claim-mapper</option>
                <option value="oidc-role-list-mapper">oidc-role-list-mapper</option>
                <option value="oidc-audience-mapper">oidc-audience-mapper</option>
                <option value="oidc-full-name-mapper">oidc-full-name-mapper</option>
              </select>
            </div>
            <div>
              <label htmlFor="mapperConfig" className="block text-sm font-medium text-muted">
                Config (JSON)
              </label>
              <textarea
                id="mapperConfig"
                value={mapperForm.config}
                onChange={(e) => setMapperForm({ ...mapperForm, config: e.target.value })}
                rows={4}
                className="w-full rounded-md border border-line-strong px-3 py-2 text-sm font-mono shadow-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              />
            </div>
            <div>
              <button
                type="submit"
                disabled={addMapperMutation.isPending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {addMapperMutation.isPending ? 'Adding...' : 'Add Mapper'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Delete Client Scope Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        title="Delete Client Scope"
        message={`Are you sure you want to delete the client scope "${scope.name}"? This action cannot be undone.`}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setShowDeleteDialog(false)}
      />

      {/* Delete Mapper Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteMapperDialog}
        title="Delete Mapper"
        message="Are you sure you want to delete this mapper? This action cannot be undone."
        onConfirm={confirmDeleteMapper}
        onCancel={() => {
          setShowDeleteMapperDialog(false)
          setMapperToDelete(null)
        }}
      />
    </div>
  )
}
