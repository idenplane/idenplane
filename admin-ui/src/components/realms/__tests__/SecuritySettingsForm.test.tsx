import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import SecuritySettingsForm from '../SecuritySettingsForm';

describe('SecuritySettingsForm', () => {
  it('seeds fields from the realm prop', () => {
    render(
      <SecuritySettingsForm
        realm={makeRealm({
          passwordMinLength: 12,
          maxLoginFailures: 7,
          riskThresholdStepUp: 40,
          riskThresholdBlock: 90,
        })}
      />,
    );
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
    expect(screen.getByDisplayValue('40')).toBeInTheDocument();
    expect(screen.getByDisplayValue('90')).toBeInTheDocument();
  });

  it('warns when brute-force protection is off', () => {
    render(<SecuritySettingsForm realm={makeRealm({ bruteForceEnabled: false })} />);
    expect(screen.getByTestId('brute-force-off-warning')).toHaveTextContent(
      'Brute-force protection is off',
    );
  });

  it('shows no brute-force warning when protection is on', () => {
    render(<SecuritySettingsForm realm={makeRealm({ bruteForceEnabled: true, permanentLockoutAfter: 0 })} />);
    expect(screen.queryByTestId('brute-force-off-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('permanent-lockout-warning')).not.toBeInTheDocument();
  });

  it('shows the warning as soon as protection is switched off', async () => {
    const user = userEvent.setup();
    render(<SecuritySettingsForm realm={makeRealm({ bruteForceEnabled: true })} />);
    await user.click(screen.getByLabelText('Enable brute force protection'));
    expect(screen.getByTestId('brute-force-off-warning')).toBeInTheDocument();
  });

  it('warns that permanent lockout can be used to disable accounts', () => {
    render(<SecuritySettingsForm realm={makeRealm({ bruteForceEnabled: true, permanentLockoutAfter: 3 })} />);
    expect(screen.getByTestId('permanent-lockout-warning')).toBeInTheDocument();
  });

  it('hides WebAuthn, rate-limit, and impersonation fields when their toggles are off', () => {
    render(
      <SecuritySettingsForm
        realm={makeRealm({ webAuthnEnabled: false, rateLimitEnabled: false, impersonationEnabled: false })}
      />,
    );
    expect(screen.queryByLabelText('Relying Party Name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Client req/min')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Max impersonation duration (seconds)')).not.toBeInTheDocument();
  });

  it('shows WebAuthn, rate-limit, and impersonation fields when their toggles are on', () => {
    render(
      <SecuritySettingsForm
        realm={makeRealm({
          webAuthnEnabled: true,
          webAuthnRpName: 'My App',
          webAuthnRpId: 'example.com',
          rateLimitEnabled: true,
          impersonationEnabled: true,
          impersonationMaxDuration: 900,
        })}
      />,
    );
    expect(screen.getByDisplayValue('My App')).toBeInTheDocument();
    expect(screen.getByDisplayValue('example.com')).toBeInTheDocument();
    expect(screen.getByText('Client req/min')).toBeInTheDocument();
    expect(screen.getByDisplayValue('900')).toBeInTheDocument();
  });

  it('submits the full security form and shows a success banner', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.put('/admin/realms/:name', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRealm(capturedBody));
      }),
    );

    const user = userEvent.setup();
    render(<SecuritySettingsForm realm={makeRealm({ name: 'my-realm' })} />);

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Security settings updated successfully.')).toBeInTheDocument();
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toMatchObject({
      passwordMinLength: 8,
      bruteForceEnabled: false,
      mfaRequired: false,
      webAuthnEnabled: false,
      rateLimitEnabled: false,
      impersonationEnabled: false,
    });
  });
});
