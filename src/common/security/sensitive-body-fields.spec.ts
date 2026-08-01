import { SENSITIVE_BODY_FIELDS } from './sensitive-body-fields.js';

describe('SENSITIVE_BODY_FIELDS', () => {
  it('should have no duplicate entries', () => {
    expect(new Set(SENSITIVE_BODY_FIELDS).size).toBe(
      SENSITIVE_BODY_FIELDS.length,
    );
  });

  it('should include the realm-config secrets this fix adds', () => {
    expect(SENSITIVE_BODY_FIELDS).toEqual(
      expect.arrayContaining([
        'recaptchaSecretKey',
        'hcaptchaSecretKey',
        'emailProviderConfig',
        'smsProviderConfig',
        'confirmPassword',
      ]),
    );
  });
});
