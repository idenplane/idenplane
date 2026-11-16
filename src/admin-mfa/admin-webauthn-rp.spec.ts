import { adminWebAuthnRp } from './admin-webauthn-rp.js';

describe('adminWebAuthnRp', () => {
  it('defaults to the host and origin of BASE_URL', () => {
    expect(
      adminWebAuthnRp(
        { webAuthnRpId: null },
        { BASE_URL: 'https://id.example.com:8443/' },
      ),
    ).toEqual({
      id: 'id.example.com',
      name: 'Idenplane admin console',
      origins: ['https://id.example.com:8443'],
      userVerificationRequired: false,
    });
  });

  it("uses the master realm's RP ID, so its passkeys work in the console", () => {
    expect(
      adminWebAuthnRp(
        { webAuthnRpId: 'example.com' },
        { BASE_URL: 'https://id.example.com' },
      ).id,
    ).toBe('example.com');
  });

  it('lets the environment override both', () => {
    expect(
      adminWebAuthnRp(
        { webAuthnRpId: 'example.com' },
        {
          BASE_URL: 'https://id.example.com',
          ADMIN_WEBAUTHN_RP_ID: 'admin.example.com',
          ADMIN_WEBAUTHN_ORIGINS:
            ' https://admin.example.com/ , http://localhost:5173 ',
        },
      ),
    ).toMatchObject({
      id: 'admin.example.com',
      origins: ['https://admin.example.com', 'http://localhost:5173'],
    });
  });

  it('falls back to localhost without a usable BASE_URL', () => {
    expect(adminWebAuthnRp({ webAuthnRpId: null }, {})).toMatchObject({
      id: 'localhost',
      origins: ['http://localhost:3000'],
    });
  });
});
