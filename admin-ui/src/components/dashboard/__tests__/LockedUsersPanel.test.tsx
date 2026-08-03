import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeLockedUser } from '../../../test/mocks/data';
import LockedUsersPanel from '../LockedUsersPanel';

const BASE = '/admin';

function renderPanel(realmName = 'test-realm') {
  return render(<LockedUsersPanel realmName={realmName} />);
}

describe('LockedUsersPanel', () => {
  it('renders the section heading', async () => {
    renderPanel();
    expect(await screen.findByRole('heading', { name: /locked out accounts/i })).toBeInTheDocument();
  });

  it('shows an empty-state message when nobody is locked out', async () => {
    renderPanel();
    expect(await screen.findByText(/no accounts are currently locked out/i)).toBeInTheDocument();
  });

  it('lists a locked user with their remaining lockout time', async () => {
    server.use(
      http.get(`${BASE}/realms/:name/brute-force/locked-users`, () =>
        HttpResponse.json([
          makeLockedUser({
            username: 'alice',
            email: 'alice@example.com',
            lockedUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
          }),
        ]),
      ),
    );
    renderPanel();

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText(/5m remaining/i)).toBeInTheDocument();
  });

  it('renders multiple locked users', async () => {
    server.use(
      http.get(`${BASE}/realms/:name/brute-force/locked-users`, () =>
        HttpResponse.json([
          makeLockedUser({ id: 'u1', username: 'alice' }),
          makeLockedUser({ id: 'u2', username: 'bob', email: null }),
        ]),
      ),
    );
    renderPanel();

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });
});
