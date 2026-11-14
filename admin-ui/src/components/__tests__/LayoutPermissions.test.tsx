import { describe, expect, it } from 'vitest';
import { render, screen } from '../../test/utils';
import { mockMe, SignedIn } from '../../test/signedIn';
import Layout from '../Layout';

const atRealm = (realm: string) => ({
  initialUrl: `/console/realms/${realm}`,
  routePattern: '/console/realms/:name',
});

describe('Layout navigation by role', () => {
  it('shows server-wide pages to a super-admin', async () => {
    mockMe({ roles: ['super-admin'], superAdmin: true, writeAllRealms: true, username: 'root-sample' });
    render(
      <SignedIn>
        <Layout />
      </SignedIn>,
      atRealm('test-realm'),
    );
    expect(await screen.findByRole('link', { name: 'Admin Accounts' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plugins' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upgrade' })).toBeInTheDocument();
    expect(screen.queryByText('Read only')).not.toBeInTheDocument();
    expect(await screen.findByTestId('signed-in-as')).toHaveTextContent('root-sample');
  });

  it('hides server-wide pages and marks the realm read-only for view-only', async () => {
    mockMe({ roles: ['view-only'] });
    render(
      <SignedIn>
        <Layout />
      </SignedIn>,
      atRealm('test-realm'),
    );
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Plugins' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'System Status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Upgrade' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin Accounts' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Realms' }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('signed-in-as')).toHaveTextContent('view-only');
  });

  it('lets a realm-admin change its own realm', async () => {
    mockMe({ roles: ['realm-admin'], readAllRealms: false, managedRealms: ['test-realm'] });
    render(
      <SignedIn>
        <Layout />
      </SignedIn>,
      atRealm('test-realm'),
    );
    expect(await screen.findByTestId('signed-in-as')).toHaveTextContent('realm-admin');
    expect(screen.queryByText('Read only')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Migration Wizard' })).not.toBeInTheDocument();
  });
});
