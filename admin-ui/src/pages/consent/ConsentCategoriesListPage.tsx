import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import type { ConsentCategory } from '../../types';
import { getConsentCategories } from '../../api/consent';

export default function ConsentCategoriesListPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const { data: consentCategories, isLoading, error } = useQuery({
    queryKey: ['consentCategories', name],
    queryFn: () => getConsentCategories(name!),
    enabled: !!name,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-subtle">Loading consent categories...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        Failed to load consent categories.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">Consent Categories</h1>
          <p className="mt-1 text-sm text-subtle">
            Manage GDPR consent categories in{' '}
            <span className="font-medium">{name}</span>
          </p>
        </div>
        <button
          onClick={() =>
            navigate(`/console/realms/${name}/consent-categories/new`)
          }
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Create Consent Category
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <table className="min-w-full divide-y divide-line">
          <thead className="bg-sunken">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Key
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Description
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Required
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {consentCategories && consentCategories.length > 0 ? (
              consentCategories.map((category: ConsentCategory) => (
                <tr
                  key={category.id}
                  onClick={() =>
                    navigate(
                      `/console/realms/${name}/consent-categories/${category.id}`,
                    )
                  }
                  className="cursor-pointer hover:bg-hover"
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-accent">
                    {category.displayName}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <code className="rounded bg-sunken px-1.5 py-0.5 text-xs text-muted">
                      {category.key}
                    </code>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-muted">
                    {category.description || '-'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        category.required
                          ? 'bg-warning-soft text-warning-fg'
                          : 'bg-sunken text-muted'
                      }`}
                    >
                      {category.required ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-subtle">
                    {new Date(category.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-8 text-center text-sm text-subtle"
                >
                  No consent categories found in this realm.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
