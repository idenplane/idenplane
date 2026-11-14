import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Alert } from './ui';
import { usePermissions } from '../hooks/usePermissions';
import { roleLabel } from '../auth/permissions';

/**
 * Renders its children only when the signed-in admin may change the realm
 * (the current route's `:name`, or `realm`). Otherwise renders `fallback`
 * (nothing by default). Use it around create, save and delete actions.
 */
export function CanWrite({
  realm,
  children,
  fallback = null,
}: {
  realm?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { name } = useParams<{ name: string }>();
  const permissions = usePermissions();
  return <>{permissions.canWriteRealm(realm ?? name) ? children : fallback}</>;
}

/** Renders its children only for a super-admin (or the admin API key). */
export function SuperAdminOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const permissions = usePermissions();
  return <>{permissions.canManageServer ? children : fallback}</>;
}

function NotAllowedPanel({ title, children }: { title: string; children: ReactNode }) {
  const permissions = usePermissions();
  return (
    <div className="mx-auto max-w-xl py-10">
      <Alert variant="warning" title={title}>
        <p>{children}</p>
        <p className="mt-2 text-xs">
          Signed in as <strong>{permissions.username ?? roleLabel(permissions)}</strong> ({roleLabel(permissions)}).
        </p>
        <p className="mt-3">
          <Link to="/console" className="font-medium underline">
            Back to the dashboard
          </Link>
        </p>
      </Alert>
    </div>
  );
}

/** Route guard: the page is for super-admins only. */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const permissions = usePermissions();
  if (permissions.known && !permissions.canManageServer) {
    return (
      <NotAllowedPanel title="Super-admin only">
        This page manages the whole server. It needs the super-admin role.
      </NotAllowedPanel>
    );
  }
  return <>{children}</>;
}

/** Route guard: the page changes the current realm (create pages, wizards). */
export function RequireRealmWrite({ children }: { children: ReactNode }) {
  const { name } = useParams<{ name: string }>();
  const permissions = usePermissions();
  if (permissions.known && !permissions.canWriteRealm(name)) {
    return (
      <NotAllowedPanel title="Read-only access">
        Your admin role can't make changes in the realm <strong>{name}</strong>.
      </NotAllowedPanel>
    );
  }
  return <>{children}</>;
}
