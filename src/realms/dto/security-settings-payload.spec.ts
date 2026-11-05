import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateRealmDto } from './update-realm.dto.js';

/**
 * Regression guard for idenplane#1558: "Can't enable webauthn for realm".
 *
 * The admin UI's Security tab (admin-ui SecuritySettingsForm) PUTs its whole
 * form state to /admin/realms/:realm. That state included
 * `webAuthnUserVerificationRequired`, which UpdateRealmDto did not declare,
 * and the global ValidationPipe runs with `forbidNonWhitelisted` — so every
 * save of that tab returned 400, with or without WebAuthn switched on.
 *
 * This runs the exact payload shape the form sends through a ValidationPipe
 * configured like the one in main.ts, so a field added to the form but not to
 * the DTO fails here instead of in production.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validateBody(body: Record<string, unknown>) {
  return pipe.transform(body, { type: 'body', metatype: UpdateRealmDto });
}

/** Mirrors seedFromRealm() in admin-ui/src/components/realms/SecuritySettingsForm.tsx. */
function securityFormPayload(overrides: Record<string, unknown> = {}) {
  return {
    passwordMinLength: 8,
    passwordRequireUppercase: false,
    passwordRequireLowercase: false,
    passwordRequireDigits: false,
    passwordRequireSpecialChars: false,
    passwordHistoryCount: 0,
    passwordMaxAgeDays: 0,
    bruteForceEnabled: false,
    maxLoginFailures: 5,
    lockoutDuration: 300,
    failureResetTime: 600,
    permanentLockoutAfter: 0,
    mfaRequired: false,
    webAuthnEnabled: false,
    webAuthnRpName: '',
    webAuthnRpId: '',
    webAuthnUserVerificationRequired: false,
    rateLimitEnabled: false,
    clientRateLimitPerMinute: 100,
    clientRateLimitPerHour: 1000,
    userRateLimitPerMinute: 30,
    userRateLimitPerHour: 300,
    ipRateLimitPerMinute: 60,
    ipRateLimitPerHour: 600,
    impersonationEnabled: false,
    impersonationMaxDuration: 1800,
    riskThresholdStepUp: 50,
    riskThresholdBlock: 80,
    maxSessionsPerUser: 0,
    adaptiveAuthEnabled: false,
    ...overrides,
  };
}

describe('Security settings form payload (idenplane#1558)', () => {
  it('accepts the form as saved with its defaults', async () => {
    await expect(validateBody(securityFormPayload())).resolves.toBeInstanceOf(
      UpdateRealmDto,
    );
  });

  it('accepts enabling WebAuthn with the required fields filled in (the reported case)', async () => {
    const dto = (await validateBody(
      securityFormPayload({
        webAuthnEnabled: true,
        webAuthnRpName: 'Homelab',
        webAuthnRpId: 'auth.example.com',
        webAuthnUserVerificationRequired: true,
      }),
    )) as UpdateRealmDto;

    expect(dto.webAuthnEnabled).toBe(true);
    expect(dto.webAuthnUserVerificationRequired).toBe(true);
  });

  it('rejects a non-boolean webAuthnUserVerificationRequired', async () => {
    await expect(
      validateBody(
        securityFormPayload({ webAuthnUserVerificationRequired: 'yes' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still rejects fields the DTO does not declare', async () => {
    await expect(
      validateBody(securityFormPayload({ notARealmSetting: true })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
