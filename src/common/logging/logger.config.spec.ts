import { createLoggerConfig } from './logger.config.js';
import { SENSITIVE_BODY_FIELDS } from '../security/sensitive-body-fields.js';

describe('createLoggerConfig', () => {
  function getRedactPaths(): string[] {
    const config = createLoggerConfig();
    return (config.pinoHttp as { redact: { paths: string[] } }).redact.paths;
  }

  it('should redact the authorization and admin API key headers', () => {
    const paths = getRedactPaths();
    expect(paths).toContain('req.headers.authorization');
    expect(paths).toContain('req.headers["x-admin-api-key"]');
  });

  it('should redact every field in the canonical sensitive-body-fields list', () => {
    const paths = getRedactPaths();
    for (const field of SENSITIVE_BODY_FIELDS) {
      expect(paths).toContain(`req.body.${field}`);
    }
  });

  it('should redact the realm-config secrets covered by this fix', () => {
    const paths = getRedactPaths();
    expect(paths).toContain('req.body.recaptchaSecretKey');
    expect(paths).toContain('req.body.hcaptchaSecretKey');
    expect(paths).toContain('req.body.emailProviderConfig');
    expect(paths).toContain('req.body.smsProviderConfig');
  });

  it('should censor redacted values with [REDACTED]', () => {
    const config = createLoggerConfig();
    expect(
      (config.pinoHttp as { redact: { censor: string } }).redact.censor,
    ).toBe('[REDACTED]');
  });
});
