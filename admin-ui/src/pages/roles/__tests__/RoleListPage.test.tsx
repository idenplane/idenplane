import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import RoleListPage from '../RoleListPage';

function renderRoleList(realm = 'test-realm') {
  return render(<RoleListPage />, {
    initialUrl: `/console/realms/${realm}/roles`,
    routePattern: '/console/realms/:name/roles',
  });
}

describe('RoleListPage', () => {
  it('renders role rows after data loads', async () => {
    renderRoleList();

    expect(await screen.findByText('admin')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  it('shows a delete mutation error when role deletion fails', async () => {
    server.use(
      http.delete('/admin/realms/:name/roles/:roleName', () =>
        HttpResponse.json({ message: 'Role is still assigned to users' }, { status: 409 }),
      ),
    );

    const user = userEvent.setup();
    renderRoleList();

    await screen.findByText('admin');

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    await user.click(deleteButtons[0]);
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(screen.getByText(/role is still assigned to users/i)).toBeInTheDocument();
    });
  });
});
