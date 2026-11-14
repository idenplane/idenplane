import { describe, expect, it } from 'vitest';
import { render, screen } from '../../test/utils';
import { mockMe, SignedIn } from '../../test/signedIn';
import ClientListPage from '../clients/ClientListPage';
import RealmListPage from '../realms/RealmListPage';

const clientsOf = (realm: string) => ({
  initialUrl: `/console/realms/${realm}/clients`,
  routePattern: '/console/realms/:name/clients',
});

describe('pages follow the signed-in role', () => {
  it('view-only sees the clients but cannot create one', async () => {
    mockMe({ roles: ['view-only'] });
    render(
      <SignedIn>
        <ClientListPage />
      </SignedIn>,
      clientsOf('test-realm'),
    );
    await screen.findByText(/Manage clients in/);
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Create Client' })).not.toBeInTheDocument(),
    );
  });

  it('a realm-admin creates clients in its realm only', async () => {
    mockMe({ roles: ['realm-admin'], readAllRealms: false, managedRealms: ['test-realm'] });
    const own = render(
      <SignedIn>
        <ClientListPage />
      </SignedIn>,
      clientsOf('test-realm'),
    );
    expect(await screen.findByRole('button', { name: 'Create Client' })).toBeInTheDocument();
    own.unmount();

    render(
      <SignedIn>
        <ClientListPage />
      </SignedIn>,
      clientsOf('other-realm'),
    );
    await screen.findByText(/Manage clients in/);
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Create Client' })).not.toBeInTheDocument(),
    );
  });

  it('offers a super-admin to create and import realms', async () => {
    mockMe({ roles: ['super-admin'], superAdmin: true, writeAllRealms: true });
    render(
      <SignedIn>
        <RealmListPage />
      </SignedIn>,
    );
    expect(await screen.findByRole('button', { name: /Create Realm/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import Realm/ })).toBeInTheDocument();
  });

  it('only a super-admin is offered to create or import realms', async () => {
    mockMe({ roles: ['realm-admin'], managedRealms: ['test-realm'] });
    render(
      <SignedIn>
        <RealmListPage />
      </SignedIn>,
    );
    await screen.findByText('test-realm');
    await vi.waitFor(() =>
      expect(screen.queryByRole('button', { name: /Create Realm/ })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /Import Realm/ })).not.toBeInTheDocument();
  });
});
