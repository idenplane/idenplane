import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../../test/utils';
import { server } from '../../../test/mocks/server';
import AdminMfaPage from '../AdminMfaPage';
import type { AdminMfaStatus } from '../../../api/adminMfa';

const CODES = Array.from({ length: 10 }, (_, i) => `aaaaaa-bbbbbb-cccccc-ddddd${i}`);

function status(overrides: Partial<AdminMfaStatus> = {}): AdminMfaStatus {
  return {
    policy: { required: false, source: 'setting' },
    enrolled: false,
    totp: false,
    passkeys: [],
    recoveryCodes: { remaining: 0, oldFormat: false },
    session: { verified: false, authTime: null },
    ...overrides,
  };
}

/** Serves GET /admin/auth/mfa from a value the test can change. */
function serveStatus(initial: AdminMfaStatus) {
  const state = { current: initial };
  server.use(http.get('/admin/auth/mfa', () => HttpResponse.json(state.current)));
  return state;
}

describe('AdminMfaPage', () => {
  it('tells an admin who must enrol that nothing else opens until they do', async () => {
    serveStatus(status({ policy: { required: true, source: 'setting' } }));
    render(<AdminMfaPage />);
    expect(await screen.findByText('Set up a second factor to continue')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /back to the console/i })).not.toBeInTheDocument();
  });

  it('sets up an authenticator app with a QR code and a manual key, then shows the codes once', async () => {
    const state = serveStatus(status());
    let activatedWith: unknown = null;
    server.use(
      http.post('/admin/auth/mfa/totp', () =>
        HttpResponse.json({
          secret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
          qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          otpauthUrl: 'otpauth://totp/sample',
        }),
      ),
      http.post('/admin/auth/mfa/totp/activate', async ({ request }) => {
        activatedWith = await request.json();
        state.current = status({
          enrolled: true,
          totp: true,
          recoveryCodes: { remaining: 10, oldFormat: false },
        });
        return HttpResponse.json({ recoveryCodes: CODES, access_token: 'new-token' });
      }),
    );
    const user = userEvent.setup();
    render(<AdminMfaPage />);

    await user.click(await screen.findByRole('button', { name: /set up an authenticator app/i }));
    expect(await screen.findByAltText('QR code for your authenticator app')).toHaveAttribute(
      'src',
      'data:image/png;base64,iVBORw0KGgo=',
    );
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP JBSW Y3DP');

    await user.type(screen.getByLabelText('Code from the app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Activate' }));

    const list = await screen.findByTestId('recovery-codes');
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(activatedWith).toEqual({ code: '123456' });

    await user.click(screen.getByRole('button', { name: /i have saved them/i }));
    expect(screen.queryByTestId('recovery-codes')).not.toBeInTheDocument();
    expect(await screen.findByText('On')).toBeInTheDocument();
  });

  it('shows the server error for a wrong activation code', async () => {
    serveStatus(status());
    server.use(
      http.post('/admin/auth/mfa/totp', () =>
        HttpResponse.json({ secret: 'ABCD', qrCodeDataUrl: 'data:,', otpauthUrl: 'otpauth://x' }),
      ),
      http.post('/admin/auth/mfa/totp/activate', () =>
        HttpResponse.json(
          { statusCode: 400, message: 'Invalid code: check the time on your device and try again' },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<AdminMfaPage />);
    await user.click(await screen.findByRole('button', { name: /set up an authenticator app/i }));
    await user.type(await screen.findByLabelText('Code from the app'), '000000');
    await user.click(screen.getByRole('button', { name: 'Activate' }));
    expect(await screen.findByText(/check the time on your device/i)).toBeInTheDocument();
  });

  it('removes the authenticator app after confirming', async () => {
    serveStatus(status({ enrolled: true, totp: true, recoveryCodes: { remaining: 4, oldFormat: false } }));
    let removed = false;
    server.use(
      http.delete('/admin/auth/mfa/totp', () => {
        removed = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<AdminMfaPage />);
    await user.click(await screen.findByRole('button', { name: /remove the authenticator app/i }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() => expect(removed).toBe(true));
  });

  it('lists passkeys and recovery codes left, and warns about old-format codes', async () => {
    serveStatus(
      status({
        enrolled: true,
        passkeys: [
          { id: 'pk-1', name: 'Laptop', createdAt: '2026-11-01T00:00:00Z', lastUsedAt: null },
        ],
        recoveryCodes: { remaining: 1, oldFormat: true },
      }),
    );
    render(<AdminMfaPage />);
    expect(await screen.findByText('Laptop')).toBeInTheDocument();
    expect(screen.getByText(/1 unused recovery code left/i)).toBeInTheDocument();
    expect(screen.getByText('Old-format recovery codes')).toBeInTheDocument();
  });

  it('generates new recovery codes and shows them', async () => {
    serveStatus(status({ enrolled: true, totp: true, recoveryCodes: { remaining: 2, oldFormat: false } }));
    server.use(
      http.post('/admin/auth/mfa/recovery-codes', () => HttpResponse.json({ recoveryCodes: CODES })),
    );
    const user = userEvent.setup();
    render(<AdminMfaPage />);
    await user.click(await screen.findByRole('button', { name: /generate new recovery codes/i }));
    expect(await screen.findByText(CODES[0])).toBeInTheDocument();
  });
});
