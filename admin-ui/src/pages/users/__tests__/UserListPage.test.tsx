import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import UserListPage from '../UserListPage';

function renderUserList(realm = 'test-realm') {
  return render(<UserListPage />, {
    initialUrl: `/console/realms/${realm}/users`,
    routePattern: '/console/realms/:name/users',
  });
}

describe('UserListPage', () => {
  it('shows loading text initially', () => {
    renderUserList();
    expect(screen.getByText(/loading users/i)).toBeInTheDocument();
  });

  it('renders user rows after data loads', async () => {
    renderUserList();
    await screen.findByText('alice');
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('renders user emails', async () => {
    renderUserList();
    await screen.findByText('alice@example.com');
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('shows the page heading', async () => {
    renderUserList();
    await screen.findByText('alice');
    expect(screen.getByRole('heading', { name: /users/i })).toBeInTheDocument();
  });

  it('shows the realm name in the description', async () => {
    renderUserList();
    await screen.findByText('alice');
    // The description reads "Manage users in test-realm"
    expect(screen.getByText(/test-realm/)).toBeInTheDocument();
  });

  it('shows enabled/disabled badges correctly', async () => {
    renderUserList();
    await screen.findByText('alice');
    // alice is enabled (Yes), bob is disabled (No)
    const badges = screen.getAllByText(/^(Yes|No)$/);
    const values = badges.map((b) => b.textContent);
    expect(values).toContain('Yes');
    expect(values).toContain('No');
  });

  it('renders the Create User button', async () => {
    renderUserList();
    await screen.findByText('alice');
    expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no users', async () => {
    server.use(
      http.get('/admin/realms/:name/users', () =>
        HttpResponse.json({ users: [], total: 0 }),
      ),
    );
    renderUserList();
    expect(await screen.findByText(/no users found/i)).toBeInTheDocument();
  });

  it('shows an error state when the API fails', async () => {
    server.use(
      http.get('/admin/realms/:name/users', () =>
        HttpResponse.json({ message: 'error' }, { status: 500 }),
      ),
    );
    renderUserList();
    expect(await screen.findByText(/error/i)).toBeInTheDocument();
  });

  it('does not render pagination when only one page exists', async () => {
    renderUserList();
    await screen.findByText('alice');
    // Default mock returns 2 users with PAGE_SIZE=20 – no pagination needed
    expect(screen.queryByRole('button', { name: /previous/i })).not.toBeInTheDocument();
  });

  it('renders pagination when multiple pages exist', async () => {
    const manyUsers = Array.from({ length: 25 }, (_, i) => ({
      id: `user-${i}`,
      realmId: 'realm-1',
      username: `user${i}`,
      email: `user${i}@example.com`,
      emailVerified: false,
      firstName: null,
      lastName: null,
      enabled: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }));

    server.use(
      http.get('/admin/realms/:name/users', ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get('page') ?? 1);
        const limit = Number(url.searchParams.get('limit') ?? 20);
        return HttpResponse.json({
          users: manyUsers.slice((page - 1) * limit, page * limit),
          total: manyUsers.length,
        });
      }),
    );

    renderUserList();
    await screen.findByText('user0');
    expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('shows total user count in description', async () => {
    renderUserList();
    await screen.findByText('alice');
    // mock returns total: 2
    expect(screen.getByText(/\(2 total\)/)).toBeInTheDocument();
  });
});
