import {
  accessForMethod,
  decideAdminAccess,
  REALM_ADMIN,
  SUPER_ADMIN,
  VIEW_ONLY,
  type AdminPrincipal,
  type AdminRole,
} from './admin-access-policy.js';
import type { AdminRouteEntry } from './admin-route-inventory.js';

/** What each kind of admin gets on a route, worked out by the real policy. */
export interface AccessMatrixRow {
  method: string;
  path: string;
  scope: string;
  superAdmin: boolean;
  apiKey: boolean;
  /** In a realm it is assigned. */
  realmAdminInScope: boolean;
  /** In any other realm. */
  realmAdminOutOfScope: boolean;
  viewOnly: boolean;
}

const IN_SCOPE = { id: 'realm-a-id', name: 'realm-a' };
const OUT_OF_SCOPE = { id: 'realm-b-id', name: 'realm-b' };

function principal(kind: 'user' | 'api-key', role: AdminRole): AdminPrincipal {
  return {
    kind,
    userId: kind === 'api-key' ? 'api-key:admin' : `sample-${role}`,
    username: null,
    roles: [role],
    realmIds: new Set(role === REALM_ADMIN ? [IN_SCOPE.id] : []),
  };
}

export function accessMatrix(entries: AdminRouteEntry[]): AccessMatrixRow[] {
  return entries.map((entry) => {
    const access = accessForMethod(entry.method, entry.policy);
    const allowed = (p: AdminPrincipal, realm = IN_SCOPE) =>
      decideAdminAccess(p, entry.policy, access, realm).allowed;
    const scope =
      entry.policy.scope.kind === 'realm'
        ? `realm (:${entry.policy.scope.param})`
        : entry.policy.scope.kind;
    return {
      method: entry.method,
      path: entry.paths.join(', '),
      scope: entry.policy.sensitiveRead ? `${scope}, secret read` : scope,
      superAdmin: allowed(principal('user', SUPER_ADMIN)),
      apiKey: allowed(principal('api-key', SUPER_ADMIN)),
      realmAdminInScope: allowed(principal('user', REALM_ADMIN)),
      realmAdminOutOfScope: allowed(
        principal('user', REALM_ADMIN),
        OUT_OF_SCOPE,
      ),
      viewOnly: allowed(principal('user', VIEW_ONLY)),
    };
  });
}

/** The matrix as a Markdown table, for the design doc and the docs site. */
export function accessMatrixMarkdown(rows: AccessMatrixRow[]): string {
  const mark = (v: boolean) => (v ? 'yes' : 'no');
  const lines = [
    '| Method | Path | Policy | super-admin | API key | realm-admin (own realm) | realm-admin (other realm) | view-only |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.method} | \`${r.path}\` | ${r.scope} | ${mark(r.superAdmin)} | ${mark(r.apiKey)} | ${mark(r.realmAdminInScope)} | ${mark(r.realmAdminOutOfScope)} | ${mark(r.viewOnly)} |`,
    );
  }
  return lines.join('\n');
}
