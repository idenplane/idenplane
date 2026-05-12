import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import ClientListPage from '../ClientListPage';

function renderClientList(realm = 'test-realm') {
  return render(<ClientListPage />, {
    initialUrl: `/console/realms/${realm}/clients`,
    routePattern: '/console/realms/:name/clients',
  });
}

describe('ClientListPage', () => {
  it('shows a loading state initially', () => {
    renderClientList();
    expect(screen.getByText(/loading clients/i)).toBeInTheDocument();
  });

  it('renders client rows after data loads', async () => {
    renderClientList();
    await screen.findByText('my-app');
    expect(screen.getByText('public-app')).toBeInTheDocument();
  });

  it('renders client names', async () => {
    renderClientList();
    await screen.findByText('My Application');
    expect(screen.getByText('Public App')).toBeInTheDocument();
  });

  it('shows the page heading', async () => {
    renderClientList();
    await screen.findByText('my-app');
    expect(screen.getByRole('heading', { name: /clients/i })).toBeInTheDocument();
  });

  it('shows the realm name in the subtitle', async () => {
    renderClientList();
    await screen.findByText('my-app');
    expect(screen.getByText(/test-realm/)).toBeInTheDocument();
  });

  it('renders the Create Client button', async () => {
    renderClientList();
    await screen.findByText('my-app');
    expect(screen.getByRole('button', { name: /create client/i })).toBeInTheDocument();
  });

  it('shows client type badges', async () => {
    renderClientList();
    await screen.findByText('my-app');
    expect(screen.getByText('CONFIDENTIAL')).toBeInTheDocument();
    expect(screen.getByText('PUBLIC')).toBeInTheDocument();
  });

  it('shows enabled badge for enabled clients', async () => {
    renderClientList();
    await screen.findByText('my-app');
    const yesBadges = screen.getAllByText('Yes');
    expect(yesBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty-state when there are no clients', async () => {
    server.use(
      http.get('/admin/realms/:name/clients', () => HttpResponse.json([])),
    );
    renderClientList();
    expect(await screen.findByText(/no clients found/i)).toBeInTheDocument();
  });

  it('shows an error state when the API fails', async () => {
    server.use(
      http.get('/admin/realms/:name/clients', () =>
        HttpResponse.json({ message: 'Failed to load clients' }, { status: 500 }),
      ),
    );
    renderClientList();
    expect(await screen.findByText(/failed to load clients/i)).toBeInTheDocument();
  });
});
