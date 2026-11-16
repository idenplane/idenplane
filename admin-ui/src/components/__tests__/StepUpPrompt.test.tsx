import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import { render } from '../../test/utils';
import { server } from '../../test/mocks/server';
import StepUpPrompt from '../StepUpPrompt';
import { ADMIN_MFA_EVENT, STEP_UP_DONE_EVENT, waitForStepUp } from '../../api/client';
import { withStepUp } from '../../utils/stepUp';
import apiClient from '../../api/client';

function refuse(code: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent(ADMIN_MFA_EVENT, { detail: { code } }));
  });
}

function renderPrompt() {
  return render(
    <>
      <StepUpPrompt />
      <Routes>
        <Route path="/" element={<p>some page</p>} />
        <Route path="/console/mfa" element={<p>mfa page</p>} />
      </Routes>
    </>,
  );
}

const withTotp = () =>
  server.use(
    http.get('/admin/auth/mfa', () =>
      HttpResponse.json({
        policy: { required: false, source: 'setting' },
        enrolled: true,
        totp: true,
        passkeys: [],
        recoveryCodes: { remaining: 3, oldFormat: false },
        session: { verified: true, authTime: 1 },
      }),
    ),
  );

describe('StepUpPrompt', () => {
  it('opens the MFA page when enrolment is required', async () => {
    renderPrompt();
    refuse('admin_mfa_enrolment_required');
    expect(await screen.findByText('mfa page')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks for the code again for a sensitive action, and reports success', async () => {
    withTotp();
    let sent: unknown = null;
    server.use(
      http.post('/admin/auth/step-up', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ access_token: 'fresh' });
      }),
    );
    const user = userEvent.setup();
    renderPrompt();
    const done = waitForStepUp();
    refuse('admin_recent_mfa_required');

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/last 15 minutes/);
    await user.type(screen.getByLabelText('Authenticator code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await expect(done).resolves.toBe(true);
    expect(sent).toEqual({ method: 'totp', code: '654321' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains a password-only session, and reports a cancel', async () => {
    withTotp();
    const user = userEvent.setup();
    renderPrompt();
    const done = waitForStepUp();
    refuse('admin_mfa_step_up_required');
    expect(await screen.findByRole('dialog')).toHaveTextContent(/password only/);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(done).resolves.toBe(false);
  });

  it('keeps the dialog open with the error for a wrong code', async () => {
    withTotp();
    server.use(
      http.post('/admin/auth/step-up', () =>
        HttpResponse.json({ statusCode: 400, message: 'Invalid code' }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderPrompt();
    refuse('admin_recent_mfa_required');
    await user.type(await screen.findByLabelText('Authenticator code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Invalid code')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('withStepUp', () => {
  it('retries the action once after the admin has verified', async () => {
    let calls = 0;
    server.use(
      http.post('/admin/auth/mfa/recovery-codes', () => {
        calls++;
        return calls === 1
          ? HttpResponse.json(
              { statusCode: 403, code: 'admin_recent_mfa_required', message: 'x' },
              { status: 403 },
            )
          : HttpResponse.json({ recoveryCodes: ['a'] });
      }),
    );
    const result = withStepUp(() => apiClient.post('/auth/mfa/recovery-codes'));
    // StepUpPrompt would show the dialog; here the admin verifies at once.
    await vi.waitFor(() => expect(calls).toBe(1));
    window.dispatchEvent(new CustomEvent(STEP_UP_DONE_EVENT, { detail: { ok: true } }));
    await expect(result).resolves.toMatchObject({ data: { recoveryCodes: ['a'] } });
    expect(calls).toBe(2);
  });

  it('passes other errors straight through', async () => {
    server.use(
      http.post('/admin/auth/mfa/recovery-codes', () =>
        HttpResponse.json({ message: 'nope' }, { status: 400 }),
      ),
    );
    await expect(withStepUp(() => apiClient.post('/auth/mfa/recovery-codes'))).rejects.toMatchObject({
      response: { status: 400 },
    });
  });
});
