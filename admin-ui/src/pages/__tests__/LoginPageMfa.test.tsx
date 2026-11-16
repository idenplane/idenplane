import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import { render } from '../../test/utils';
import { server } from '../../test/mocks/server';
import LoginPage from '../LoginPage';

/** Renders the login page with landing spots for where it navigates. */
function renderLogin() {
  return render(
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/console" element={<p>console home</p>} />
      <Route path="/console/mfa" element={<p>mfa page</p>} />
    </Routes>,
  );
}

async function signInWithPassword() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^username$/i), 'admin');
  await user.type(screen.getByPlaceholderText(/enter your password/i), 'password');
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
  return user;
}

const challenge = (methods: string[]) =>
  http.post('/admin/auth/login', () =>
    HttpResponse.json({ mfa_required: true, mfa_token: 'mfa-dummy', methods }),
  );

describe('LoginPage – second factor', () => {
  it('asks for the authenticator code, then signs in', async () => {
    let sent: unknown = null;
    server.use(
      challenge(['totp', 'recovery']),
      http.post('/admin/auth/login/mfa', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ access_token: 'tok' });
      }),
    );
    renderLogin();
    const user = await signInWithPassword();

    const input = await screen.findByLabelText('Authenticator code');
    expect(screen.queryByLabelText(/^username$/i)).not.toBeInTheDocument();
    await user.type(input, '123456');
    await user.click(screen.getByRole('button', { name: /^verify$/i }));

    expect(await screen.findByText('console home')).toBeInTheDocument();
    expect(sent).toEqual({ mfa_token: 'mfa-dummy', method: 'totp', code: '123456' });
  });

  it('switches to a recovery code', async () => {
    let sent: { method?: string } = {};
    server.use(
      challenge(['totp', 'recovery']),
      http.post('/admin/auth/login/mfa', async ({ request }) => {
        sent = (await request.json()) as { method?: string };
        return HttpResponse.json({ access_token: 'tok' });
      }),
    );
    renderLogin();
    const user = await signInWithPassword();
    await user.click(await screen.findByRole('button', { name: /use a recovery code/i }));
    await user.type(screen.getByLabelText('Recovery code'), 'abcdef-ghijkl-mnopqr-stuvwx');
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    expect(await screen.findByText('console home')).toBeInTheDocument();
    expect(sent.method).toBe('recovery');
  });

  it('refuses a wrong code and lets the admin try again', async () => {
    server.use(
      challenge(['totp']),
      http.post('/admin/auth/login/mfa', () =>
        HttpResponse.json({ statusCode: 401, message: 'Invalid code' }, { status: 401 }),
      ),
    );
    renderLogin();
    const user = await signInWithPassword();
    await user.type(await screen.findByLabelText('Authenticator code'), '000000');
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/was not accepted/i);
    // Still on the second step.
    expect(screen.getByLabelText('Authenticator code')).toHaveValue('');
  });

  it('starts over when the sign-in has expired', async () => {
    server.use(
      challenge(['totp']),
      http.post('/admin/auth/login/mfa', () =>
        HttpResponse.json(
          {
            statusCode: 401,
            message: 'The sign-in has expired or had too many attempts. Sign in again.',
          },
          { status: 401 },
        ),
      ),
    );
    renderLogin();
    const user = await signInWithPassword();
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: /^verify$/i }));
    expect(await screen.findByText(/has expired\. sign in again/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
  });

  it('sends an admin who must enrol to the MFA page', async () => {
    server.use(
      http.post('/admin/auth/login', () =>
        HttpResponse.json({ access_token: 'tok', mfa_enrolment_required: true }),
      ),
    );
    renderLogin();
    await signInWithPassword();
    expect(await screen.findByText('mfa page')).toBeInTheDocument();
  });

  it('says so when the account is locked', async () => {
    server.use(
      http.post('/admin/auth/login', () =>
        HttpResponse.json({ statusCode: 429, message: 'Account locked' }, { status: 429 }),
      ),
    );
    renderLogin();
    await signInWithPassword();
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });
});
