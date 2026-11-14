import { describe, expect, it } from 'vitest';
import { render, screen } from '../../test/utils';
import { mockMe, SignedIn } from '../../test/signedIn';
import {
  CanWrite,
  RequireRealmWrite,
  RequireSuperAdmin,
  SuperAdminOnly,
} from '../PermissionGate';

function Probe() {
  return (
    <>
      <CanWrite>
        <button type="button">Create client</button>
      </CanWrite>
      <SuperAdminOnly>
        <button type="button">Delete realm</button>
      </SuperAdminOnly>
      <span>page body</span>
    </>
  );
}

const at = { initialUrl: '/console/realms/acme/clients', routePattern: '/console/realms/:name/clients' };

describe('PermissionGate', () => {
  it('shows every action to a super-admin', async () => {
    mockMe({ roles: ['super-admin'], superAdmin: true, writeAllRealms: true });
    render(
      <SignedIn>
        <Probe />
      </SignedIn>,
      at,
    );
    expect(await screen.findByRole('button', { name: 'Create client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete realm' })).toBeInTheDocument();
  });

  it('hides changes from view-only once the server has answered', async () => {
    mockMe({ roles: ['view-only'] });
    render(
      <SignedIn>
        <Probe />
      </SignedIn>,
      at,
    );
    await screen.findByText('page body');
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Create client' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Delete realm' })).not.toBeInTheDocument();
  });

  it('lets a realm-admin change its own realm only', async () => {
    mockMe({ roles: ['realm-admin'], readAllRealms: false, managedRealms: ['acme'] });
    const { unmount } = render(
      <SignedIn>
        <Probe />
      </SignedIn>,
      at,
    );
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete realm' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Create client' })).toBeInTheDocument();
    unmount();

    render(
      <SignedIn>
        <Probe />
      </SignedIn>,
      { initialUrl: '/console/realms/other/clients', routePattern: '/console/realms/:name/clients' },
    );
    await screen.findByText('page body');
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Create client' })).not.toBeInTheDocument(),
    );
  });

  it('replaces a create page with a read-only panel', async () => {
    mockMe({ roles: ['view-only'] });
    render(
      <SignedIn>
        <RequireRealmWrite>
          <h1>New client form</h1>
        </RequireRealmWrite>
      </SignedIn>,
      { initialUrl: '/console/realms/acme/clients/new', routePattern: '/console/realms/:name/clients/new' },
    );
    expect(await screen.findByText('Read-only access')).toBeInTheDocument();
    expect(screen.queryByText('New client form')).not.toBeInTheDocument();
    expect(screen.getByText(/sample-admin/)).toBeInTheDocument();
  });

  it('replaces a server-wide page for anyone but a super-admin', async () => {
    mockMe({ roles: ['realm-admin'], managedRealms: ['acme'] });
    render(
      <SignedIn>
        <RequireSuperAdmin>
          <h1>Plugins</h1>
        </RequireSuperAdmin>
      </SignedIn>,
    );
    expect(await screen.findByText('Super-admin only')).toBeInTheDocument();
    expect(screen.queryByText('Plugins')).not.toBeInTheDocument();
  });

  it('shows the page to a super-admin', async () => {
    mockMe({ roles: ['super-admin'], superAdmin: true });
    render(
      <SignedIn>
        <RequireSuperAdmin>
          <h1>Plugins</h1>
        </RequireSuperAdmin>
      </SignedIn>,
    );
    expect(await screen.findByText('Plugins')).toBeInTheDocument();
  });
});
