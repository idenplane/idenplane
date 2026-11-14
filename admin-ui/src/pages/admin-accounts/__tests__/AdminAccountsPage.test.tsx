import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '../../../test/utils';
import { server } from '../../../test/mocks/server';
import AdminAccountsPage from '../AdminAccountsPage';

describe('AdminAccountsPage', () => {
  it('lists admins and warns about realm-admins without realms', async () => {
    render(<AdminAccountsPage />);
    const card = await screen.findByTestId('admin-account-ops-sample');
    expect(within(card).getByText('realm-admin')).toBeInTheDocument();
    expect(within(card).getByText('none')).toBeInTheDocument();
    expect(screen.getByText('Realm-admins without realms')).toBeInTheDocument();
    // A super-admin has no realm list to edit.
    const root = screen.getByTestId('admin-account-admin');
    expect(within(root).queryByRole('button', { name: 'Edit realms' })).not.toBeInTheDocument();
  });

  it('assigns realms to a realm-admin, never offering master', async () => {
    let saved: unknown = null;
    server.use(
      http.put('/admin/admin-accounts/:userId/realms', async ({ params, request }) => {
        saved = { userId: params.userId, body: await request.json() };
        return HttpResponse.json({ realms: ['test-realm'] });
      }),
    );
    render(<AdminAccountsPage />);
    const card = await screen.findByTestId('admin-account-ops-sample');
    await userEvent.click(within(card).getByRole('button', { name: 'Edit realms' }));

    expect(within(card).queryByLabelText('master')).not.toBeInTheDocument();
    await userEvent.click(await within(card).findByLabelText('test-realm'));
    await userEvent.click(within(card).getByRole('button', { name: 'Save realms' }));

    await vi.waitFor(() =>
      expect(saved).toEqual({ userId: 'ra-1', body: { realms: ['test-realm'] } }),
    );
  });

  it('shows the server error when saving fails', async () => {
    server.use(
      http.put('/admin/admin-accounts/:userId/realms', () =>
        HttpResponse.json(
          { statusCode: 400, message: 'The master realm cannot be assigned to a realm-admin' },
          { status: 400 },
        ),
      ),
    );
    render(<AdminAccountsPage />);
    const card = await screen.findByTestId('admin-account-ops-sample');
    await userEvent.click(within(card).getByRole('button', { name: 'Edit realms' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Save realms' }));
    expect(
      await within(card).findByText('The master realm cannot be assigned to a realm-admin'),
    ).toBeInTheDocument();
  });
});
