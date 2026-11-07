import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { render } from '../../../test/utils';
import { makeRealm } from '../../../test/mocks/data';
import SmsProviderForm from '../SmsProviderForm';

// What the API returns in place of a stored secret (and accepts back as "keep").
const PLACEHOLDER = '••••••';

describe('SmsProviderForm', () => {
  it('keeps the SMS MFA switch off until a provider is chosen', () => {
    render(<SmsProviderForm realm={makeRealm({ smsProvider: 'none' })} />);

    const toggle = screen.getByRole('switch', {
      name: /enable sms multi-factor authentication/i,
    });
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText('Choose an SMS provider below before turning this on.'),
    ).toBeInTheDocument();
  });

  it('turns SMS MFA on and saves it with the provider', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put('/admin/realms/:name', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRealm(body));
      }),
    );
    const user = userEvent.setup();
    render(
      <SmsProviderForm
        realm={makeRealm({ name: 'my-realm', smsProvider: 'twilio' })}
      />,
    );

    const toggle = screen.getByRole('switch', {
      name: /enable sms multi-factor authentication/i,
    });
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(
      await screen.findByText('SMS settings saved successfully.'),
    ).toBeInTheDocument();
    expect(body).toMatchObject({ smsMfaEnabled: true, smsProvider: 'twilio' });
  });

  it('saves the provider settings, sending stored secrets back as the placeholder', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put('/admin/realms/:name', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeRealm(body));
      }),
    );

    const user = userEvent.setup();
    render(
      <SmsProviderForm
        realm={makeRealm({
          name: 'my-realm',
          smsProvider: 'twilio',
          smsFrom: '+15550001111',
          smsProviderConfig: {
            twilioAccountSid: 'AC123',
            twilioAuthToken: PLACEHOLDER,
          },
        })}
      />,
    );

    expect(screen.getByDisplayValue('AC123')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(
      await screen.findByText('SMS settings saved successfully.'),
    ).toBeInTheDocument();
    expect(body).toMatchObject({
      smsProvider: 'twilio',
      smsFrom: '+15550001111',
      smsProviderConfig: {
        twilioAccountSid: 'AC123',
        twilioAuthToken: PLACEHOLDER,
      },
    });
  });
});
