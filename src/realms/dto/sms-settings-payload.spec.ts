import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateRealmDto } from './update-realm.dto.js';
import { SECRET_PLACEHOLDER } from '../secret-placeholder.js';

/**
 * The admin UI's SMS tab (admin-ui SmsProviderForm) PUTs these fields to
 * /admin/realms/:realm. None of them were on UpdateRealmDto, and the global
 * ValidationPipe runs with forbidNonWhitelisted, so the tab could never save.
 * This runs the form's exact payload through a pipe configured like main.ts.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validateBody(body: Record<string, unknown>) {
  return pipe.transform(body, { type: 'body', metatype: UpdateRealmDto });
}

/** Mirrors the mutation body in admin-ui/src/components/sms/SmsProviderForm.tsx. */
function smsFormPayload(overrides: Record<string, unknown> = {}) {
  return {
    smsMfaEnabled: false,
    smsProvider: 'twilio',
    smsFrom: '+15550001111',
    smsProviderConfig: {
      twilioAccountSid: 'AC123',
      twilioAuthToken: 'tw-secret',
      webhookHeaders: '{}',
      webhookTimeout: 30000,
    },
    otpLength: 6,
    otpExpirySeconds: 300,
    smsMaxRequestsPerUser: 3,
    smsRateLimitWindow: 900,
    ...overrides,
  };
}

describe('SMS settings form payload', () => {
  it('accepts the form as the SMS tab sends it', async () => {
    const dto = (await validateBody(smsFormPayload())) as UpdateRealmDto;

    expect(dto.smsProvider).toBe('twilio');
    expect(dto.smsProviderConfig?.twilioAuthToken).toBe('tw-secret');
  });

  it.each(['none', 'twilio', 'vonage', 'aws-sns', 'webhook'])(
    'accepts provider %p',
    async (smsProvider) => {
      await expect(
        validateBody(smsFormPayload({ smsProvider })),
      ).resolves.toBeInstanceOf(UpdateRealmDto);
    },
  );

  it('accepts a webhook configuration', async () => {
    await expect(
      validateBody(
        smsFormPayload({
          smsProvider: 'webhook',
          smsProviderConfig: {
            webhookUrl: 'https://sms.example.com/send',
            webhookHeaders: '{"Authorization":"Bearer x"}',
            webhookTimeout: 10000,
          },
        }),
      ),
    ).resolves.toBeInstanceOf(UpdateRealmDto);
  });

  it('accepts the form saved unchanged after a read, when every secret is the placeholder', async () => {
    await expect(
      validateBody(
        smsFormPayload({
          smsProvider: 'webhook',
          smsProviderConfig: {
            webhookUrl: 'https://sms.example.com/send',
            webhookHeaders: SECRET_PLACEHOLDER,
            twilioAuthToken: SECRET_PLACEHOLDER,
            vonageApiSecret: SECRET_PLACEHOLDER,
            awsSecretAccessKey: SECRET_PLACEHOLDER,
          },
        }),
      ),
    ).resolves.toBeInstanceOf(UpdateRealmDto);
  });

  it.each([
    ['an unknown provider', { smsProvider: 'carrier-pigeon' }],
    ['an OTP shorter than 4 digits', { otpLength: 3 }],
    ['an OTP expiry above the 600s the UI allows', { otpExpirySeconds: 601 }],
    [
      'webhook headers that are not JSON',
      { smsProviderConfig: { webhookHeaders: 'Authorization: Bearer x' } },
    ],
    [
      'a webhook URL without a scheme',
      { smsProviderConfig: { webhookUrl: 'sms.example.com/send' } },
    ],
    [
      'a new token typed after the hidden-value marker',
      { smsProviderConfig: { twilioAuthToken: `${SECRET_PLACEHOLDER}AC9f00` } },
    ],
    [
      'webhook headers typed after the hidden-value marker',
      { smsProviderConfig: { webhookHeaders: `${SECRET_PLACEHOLDER}{}` } },
    ],
    [
      'an unknown field inside smsProviderConfig',
      { smsProviderConfig: { twilioApiPassword: 'x' } },
    ],
  ])('rejects %s', async (_label, overrides) => {
    await expect(
      validateBody(smsFormPayload(overrides)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
