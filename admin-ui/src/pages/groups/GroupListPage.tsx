import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getGroups } from '../../api/groups';
import type { Group } from '../../types';
import { getErrorMessage } from '../../utils/getErrorMessage';

function buildTree(groups: Group[]): (Group & { depth: number })[] {
  const map = new Map<string, Group>();
  for (const g of groups) map.set(g.id, g);

  const roots: Group[] = [];
  const childrenMap = new Map<string, Group[]>();

  for (const g of groups) {
    if (!g.parentId || !map.has(g.parentId)) {
      roots.push(g);
    } else {
      const siblings = childrenMap.get(g.parentId) ?? [];
      siblings.push(g);
      childrenMap.set(g.parentId, siblings);
    }
  }

  const result: (Group & { depth: number })[] = [];
  const walk = (nodes: Group[], depth: number) => {
    for (const n of nodes.sort((a, b) => a.name.localeCompare(b.name))) {
      result.push({ ...n, depth });
      const children = childrenMap.get(n.id);
      if (children) walk(children, depth + 1);
    }
  };
  walk(roots, 0);
  return result;
}

export default function GroupListPage() {
  const { name } = useParams<{ name: string }>();

  const { data: groups, isLoading, error } = useQuery({
    queryKey: ['groups', name],
    queryFn: () => getGroups(name!),
    enabled: !!name,
  });

  const tree = groups ? buildTree(groups) : [];

  if (error) {
    return (
      <div className="rounded-md bg-danger-soft p-4 text-sm text-danger-fg">
        {getErrorMessage(error, 'Failed to load groups.')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Groups</h1>
        <Link
          to={`/console/realms/${name}/groups/create`}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Create Group
        </Link>
      </div>

      {isLoading ? (
        <div className="text-subtle">Loading groups...</div>
      ) : tree.length === 0 ? (
        <div className="rounded-md border border-line bg-surface p-8 text-center text-subtle">
          No groups created yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          <table aria-label="Groups list" className="min-w-full divide-y divide-line">
            <thead className="bg-sunken">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-subtle">
                  Members
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tree.map((group) => (
                <tr key={group.id} className="hover:bg-hover">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link
                      to={`/console/realms/${name}/groups/${group.id}`}
                      className="font-medium text-accent hover:text-accent"
                      style={{ paddingLeft: `${group.depth * 1.5}rem` }}
                    >
                      {group.depth > 0 && (
                        <span className="mr-1 text-subtle">&#8627;</span>
                      )}
                      {group.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle">
                    {group.description || '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-subtle">
                    {group._count?.userGroups ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
