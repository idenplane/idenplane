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
});
