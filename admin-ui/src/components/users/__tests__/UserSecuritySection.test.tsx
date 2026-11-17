import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import UserSecuritySection from '../UserSecuritySection';

const BASE = '/admin/realms';

describe('UserSecuritySection', () => {
  it('lists the second factors and removes only the phone', async () => {
    let smsDeleted = false;
    let allDeleted = false;
    server.use(
      http.get(`${BASE}/:name/users/:id/mfa/status`, () =>
        HttpResponse.json({ enabled: true, methods: ['totp', 'sms'] }),
      ),
      http.delete(`${BASE}/:name/users/:id/mfa/sms`, () => {
        smsDeleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(`${BASE}/:name/users/:id/mfa`, () => {
        allDeleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(
      <UserSecuritySection realmName="my-realm" userId="u1" username="alice" />,
    );

    expect(await screen.findByText('Authenticator app')).toBeInTheDocument();
    expect(screen.getByText('Text message')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove phone' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText('The phone number has been removed.'),
    ).toBeInTheDocument();
    expect(smsDeleted).toBe(true);
    expect(allDeleted).toBe(false);
  });

  it('offers no separate phone removal when SMS is the only factor', async () => {
    server.use(
      http.get(`${BASE}/:name/users/:id/mfa/status`, () =>
        HttpResponse.json({ enabled: true, methods: ['sms'] }),
      ),
    );
    render(
      <UserSecuritySection realmName="my-realm" userId="u1" username="alice" />,
    );

    expect(await screen.findByText('Text message')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove phone' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset MFA' })).toBeInTheDocument();
  });
  it('a full reset removes passkeys by default', async () => {
    let query: string | null = 'unset';
    server.use(
      http.get(`${BASE}/:name/users/:id/mfa/status`, () =>
        HttpResponse.json({ enabled: true, methods: ['totp'], passkeys: 1 }),
      ),
      http.get(`${BASE}/:name/users/:id/mfa/passkeys`, () =>
        HttpResponse.json([
          {
            id: 'pk1',
            friendlyName: 'YubiKey',
            deviceType: 'singleDevice',
            backedUp: false,
            transports: ['usb'],
            createdAt: '2026-11-01T00:00:00Z',
            lastUsedAt: null,
          },
        ]),
      ),
      http.delete(`${BASE}/:name/users/:id/mfa`, ({ request }) => {
        query = new URL(request.url).searchParams.get('keepPasskeys');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(
      <UserSecuritySection realmName="my-realm" userId="u1" username="alice" />,
    );

    expect(await screen.findByText('YubiKey')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset MFA' }));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText('MFA has been reset successfully.'),
    ).toBeInTheDocument();
    expect(query).toBeNull();
  });

  it('the admin can keep the passkeys', async () => {
    let query: string | null = null;
    server.use(
      http.get(`${BASE}/:name/users/:id/mfa/status`, () =>
        HttpResponse.json({ enabled: true, methods: ['totp'], passkeys: 2 }),
      ),
      http.get(`${BASE}/:name/users/:id/mfa/passkeys`, () => HttpResponse.json([])),
      http.delete(`${BASE}/:name/users/:id/mfa`, ({ request }) => {
        query = new URL(request.url).searchParams.get('keepPasskeys');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(
      <UserSecuritySection realmName="my-realm" userId="u1" username="alice" />,
    );

    await user.click(await screen.findByRole('button', { name: 'Reset MFA' }));
    await user.click(screen.getByRole('checkbox', { name: /Keep the user's 2 passkeys/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText('MFA has been reset successfully.'),
    ).toBeInTheDocument();
    expect(query).toBe('true');
  });

  it('a passkey-only user can be reset, and single passkeys removed', async () => {
    let removed = '';
    server.use(
      http.get(`${BASE}/:name/users/:id/mfa/status`, () =>
        HttpResponse.json({ enabled: false, methods: [], passkeys: 1 }),
      ),
      http.get(`${BASE}/:name/users/:id/mfa/passkeys`, () =>
        HttpResponse.json([
          {
            id: 'pk1',
            friendlyName: 'Unknown laptop',
            deviceType: 'multiDevice',
            backedUp: true,
            transports: ['internal'],
            createdAt: '2026-11-01T00:00:00Z',
            lastUsedAt: '2026-11-02T00:00:00Z',
          },
        ]),
      ),
      http.delete(`${BASE}/:name/users/:id/mfa/passkeys/:pk`, ({ params }) => {
        removed = String(params['pk']);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(
      <UserSecuritySection realmName="my-realm" userId="u1" username="alice" />,
    );

    expect(await screen.findByText('Unknown laptop')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset MFA' })).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Remove passkey Unknown laptop' }),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText(
        'The passkey has been removed and the user signed out everywhere.',
      ),
    ).toBeInTheDocument();
    expect(removed).toBe('pk1');
  });
});
