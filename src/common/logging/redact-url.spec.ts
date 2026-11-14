import { redactUrl } from './redact-url.js';

describe('redactUrl', () => {
  it('hides the invitation token in the accept path', () => {
    expect(
      redactUrl('/admin/realms/r/organizations/acme/invitations/abc123/accept'),
    ).toBe('/admin/realms/r/organizations/acme/invitations/[REDACTED]/accept');
  });

  it('leaves other invitation paths alone', () => {
    expect(
      redactUrl('/admin/realms/r/organizations/acme/invitations/inv-1'),
    ).toBe('/admin/realms/r/organizations/acme/invitations/inv-1');
  });

  it('hides secret query values and keeps their names', () => {
    expect(
      redactUrl(
        '/realms/r/magic-link/verify?token=t0k3n&lang=en&code=c0de&CLIENT_SECRET=s3cr3t',
      ),
    ).toBe(
      '/realms/r/magic-link/verify?token=[REDACTED]&lang=en&code=[REDACTED]&CLIENT_SECRET=[REDACTED]',
    );
  });

  it('matches percent-encoded parameter names', () => {
    expect(redactUrl('/x?%74oken=abc')).toBe('/x?%74oken=[REDACTED]');
  });

  it('keeps URLs without secrets unchanged', () => {
    expect(redactUrl('/health/ready')).toBe('/health/ready');
    expect(redactUrl('/realms/r/login?lang=en&ui_locales=ar')).toBe(
      '/realms/r/login?lang=en&ui_locales=ar',
    );
  });

  it('copes with malformed and empty input', () => {
    expect(redactUrl('/x?%E0%A4%A=1&token=a')).toBe(
      '/x?%E0%A4%A=1&token=[REDACTED]',
    );
    expect(redactUrl('/x?&&token&=')).toBe('/x?&&token&=');
    expect(redactUrl('')).toBe('');
    expect(redactUrl(undefined)).toBeUndefined();
  });

  it('stays fast on hostile input', () => {
    const hostile =
      '/a' + '/invitations/x'.repeat(20000) + '?' + 'a=b&'.repeat(20000);
    const started = Date.now();
    redactUrl(hostile);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
