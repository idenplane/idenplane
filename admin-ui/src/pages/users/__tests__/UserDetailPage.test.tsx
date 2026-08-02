import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test/utils';
import { server } from '../../../test/mocks/server';
import { makeUser } from '../../../test/mocks/data';
import UserDetailPage from '../UserDetailPage';

const BASE = '/admin';

function mockUserSubResources() {
  server.use(
    http.get(`${BASE}/realms/:name/roles`, () => HttpResponse.json([])),
    http.get(`${BASE}/realms/:name/users/:id/role-mappings/realm`, () => HttpResponse.json([])),
    http.get(`${BASE}/realms/:name/clients`, () => HttpResponse.json([])),
    http.get(`${BASE}/realms/:name/users/:id/groups`, () => HttpResponse.json([])),
    http.get(`${BASE}/realms/:name/groups`, () => HttpResponse.json([])),
    http.get(`${BASE}/realms/:name/users/:id/sessions`, () => HttpResponse.json([])),
    http.get(`${BASE}/realms/:name/users/:id/offline-sessions`, () => HttpResponse.json([])),
    http.get(`${BASE}/realms/:name/users/:id/mfa/status`, () => HttpResponse.json({ enabled: false })),
  );
}

function renderPage(realm = 'test-realm', userId = 'user-1') {
  return render(<UserDetailPage />, {
    initialUrl: `/console/realms/${realm}/users/${userId}`,
    routePattern: '/console/realms/:name/users/:id',
  });
}

describe('UserDetailPage', () => {
  it('renders the username heading and every section', async () => {
    mockUserSubResources();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'testuser' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Set Password' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Security' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Role Mappings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Client Role Mappings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Active Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Offline Sessions' })).toBeInTheDocument();
  });

  it('seeds the profile form from the fetched user', async () => {
    mockUserSubResources();
    server.use(
      http.get(`${BASE}/realms/:name/users/:id`, () =>
        HttpResponse.json(makeUser({ id: 'user-1', username: 'testuser', email: 'seeded@example.com' })),
      ),
    );
    renderPage();

    await screen.findByRole('heading', { name: 'testuser' });
    expect(screen.getByLabelText('Email')).toHaveValue('seeded@example.com');
  });

  it('shows "No roles assigned." when the user has no realm roles', async () => {
    mockUserSubResources();
    renderPage();

    expect(await screen.findByText('No roles assigned.')).toBeInTheDocument();
  });

  it('shows "Not a member of any group." when the user has no groups', async () => {
    mockUserSubResources();
    renderPage();

    expect(await screen.findByText('Not a member of any group.')).toBeInTheDocument();
  });

  it('shows "No active sessions." and "No offline sessions." when there are none', async () => {
    mockUserSubResources();
    renderPage();

    expect(await screen.findByText('No active sessions.')).toBeInTheDocument();
    expect(await screen.findByText('No offline sessions.')).toBeInTheDocument();
  });

  it('opens the delete confirmation dialog', async () => {
    mockUserSubResources();
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: 'testuser' });
    await user.click(screen.getByRole('button', { name: 'Delete User' }));
    expect(await screen.findByText(/are you sure you want to delete user "testuser"/i)).toBeInTheDocument();
  });

  it('shows "Not configured" MFA status by default', async () => {
    mockUserSubResources();
    renderPage();

    expect(await screen.findByText('Not configured')).toBeInTheDocument();
  });

  it('shows "User not found." for a 404 response', async () => {
    mockUserSubResources();
    server.use(
      http.get(`${BASE}/realms/:name/users/:id`, () =>
        HttpResponse.json({ message: 'Not found' }, { status: 404 }),
      ),
    );
    renderPage();

    expect(await screen.findByText('User not found.')).toBeInTheDocument();
  });
});
