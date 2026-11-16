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

  it("shows each admin's second factors and offers a reset for those who have one", async () => {
    render(<AdminAccountsPage />);
    const root = await screen.findByTestId('admin-account-admin');
    expect(within(root).getByText('authenticator app · 1 passkey')).toBeInTheDocument();
    const ops = screen.getByTestId('admin-account-ops-sample');
    expect(within(ops).getByText('not set up')).toBeInTheDocument();
    expect(within(ops).queryByRole('button', { name: 'Reset MFA' })).not.toBeInTheDocument();
  });

  it("resets an admin's MFA after confirming", async () => {
    let reset: string | null = null;
    server.use(
      http.get('/admin/auth/me', () =>
        HttpResponse.json({
          userId: 'other', username: 'someone-else', kind: 'user', roles: ['super-admin'],
          superAdmin: true, readAllRealms: true, writeAllRealms: true, managedRealms: [], mfa: null,
        }),
      ),
      http.delete('/admin/admin-accounts/:userId/mfa', ({ params }) => {
        reset = params.userId as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(<AdminAccountsPage />);
    const root = await screen.findByTestId('admin-account-admin');
    await userEvent.click(await within(root).findByRole('button', { name: 'Reset MFA' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/recorded as an admin event/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset MFA' }));
    await vi.waitFor(() => expect(reset).toBe('admin-1'));
  });

  it('turns the requirement on, and shows who still has no factor', async () => {
    let body: unknown = null;
    server.use(
      http.put('/admin/admin-mfa/policy', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ required: true, source: 'setting' });
      }),
    );
    render(<AdminAccountsPage />);
    const card = await screen.findByTestId('admin-mfa-requirement');
    const toggle = within(card).getByRole('switch');
    await vi.waitFor(() => expect(toggle).toBeEnabled());
    await userEvent.click(toggle);
    await vi.waitFor(() => expect(body).toEqual({ required: true }));
    expect(
      await within(card).findByText('1 admin has no second factor yet and can only set one up.'),
    ).toBeInTheDocument();
  });

  it('cannot change a requirement fixed by ADMIN_MFA_REQUIRED', async () => {
    server.use(
      http.get('/admin/admin-mfa/policy', () =>
        HttpResponse.json({ required: true, source: 'environment' }),
      ),
    );
    render(<AdminAccountsPage />);
    const card = await screen.findByTestId('admin-mfa-requirement');
    expect(await within(card).findByText(/Set by ADMIN_MFA_REQUIRED/)).toBeInTheDocument();
    expect(within(card).getByRole('switch')).toBeDisabled();
  });
});
