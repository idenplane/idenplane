import {
  authenticates,
  isCertificateCredentialType,
  liveCertificateCredentialFilter,
  nhiCredentialStatus,
  type NhiCredentialStatus,
  type StatusCredential,
} from './nhi-credential-status.js';

const now = new Date('2026-11-13T12:00:00Z');
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
const HOUR = 3_600_000;

const active: StatusCredential = {
  enabled: true,
  revoked: false,
  expiresAt: null,
  certNotBefore: at(-HOUR),
  certNotAfter: at(HOUR),
  supersededById: null,
  rotationGraceUntil: null,
};
const identity = { enabled: true, lifecycleStatus: 'ACTIVE' as const };

describe('nhiCredentialStatus', () => {
  const cases: [string, Partial<StatusCredential>, NhiCredentialStatus][] = [
    ['an active credential', {}, 'active'],
    [
      'a superseded credential inside its grace period',
      { supersededById: 'new', rotationGraceUntil: at(HOUR) },
      'grace',
    ],
    [
      'a superseded credential past its grace period',
      { supersededById: 'new', rotationGraceUntil: at(-1) },
      'expired',
    ],
    [
      'a superseded credential without a grace period',
      { supersededById: 'new', rotationGraceUntil: null },
      'expired',
    ],
    ['a revoked credential', { revoked: true }, 'revoked'],
    ['a disabled credential', { enabled: false }, 'disabled'],
    ['a certificate past notAfter', { certNotAfter: at(-1) }, 'expired'],
    ['a credential past expiresAt', { expiresAt: at(-1) }, 'expired'],
    [
      'a certificate before notBefore',
      { certNotBefore: at(HOUR) },
      'not_yet_valid',
    ],
    [
      'a PKI credential (no certificate window)',
      { certNotBefore: null, certNotAfter: null },
      'active',
    ],
  ];

  it.each(cases)('%s', (_name, patch, expected) => {
    expect(nhiCredentialStatus({ ...active, ...patch }, identity, now)).toBe(
      expected,
    );
  });

  it.each([
    ['disabled', { enabled: false, lifecycleStatus: 'ACTIVE' as const }],
    [
      'PROVISIONING',
      { enabled: true, lifecycleStatus: 'PROVISIONING' as const },
    ],
    ['SUSPENDED', { enabled: true, lifecycleStatus: 'SUSPENDED' as const }],
    [
      'DECOMMISSIONED',
      { enabled: true, lifecycleStatus: 'DECOMMISSIONED' as const },
    ],
  ])(
    'an identity that is %s makes every credential identity_inactive',
    (_n, who) => {
      expect(nhiCredentialStatus(active, who, now)).toBe('identity_inactive');
    },
  );

  it('the most fundamental reason wins', () => {
    const everything = {
      ...active,
      enabled: false,
      revoked: true,
      certNotAfter: at(-1),
      supersededById: 'new',
      rotationGraceUntil: at(HOUR),
    };
    expect(nhiCredentialStatus(everything, identity, now)).toBe('disabled');
    expect(
      nhiCredentialStatus({ ...everything, enabled: true }, identity, now),
    ).toBe('revoked');
    expect(
      nhiCredentialStatus(
        { ...everything, enabled: true, revoked: false },
        identity,
        now,
      ),
    ).toBe('expired');
  });

  it('only active and grace authenticate', () => {
    const all: NhiCredentialStatus[] = [
      'active',
      'grace',
      'revoked',
      'expired',
      'not_yet_valid',
      'disabled',
      'identity_inactive',
    ];
    expect(all.filter(authenticates)).toEqual(['active', 'grace']);
  });
});

describe('certificate credential helpers', () => {
  it('CERTIFICATE and MTLS hold certificates', () => {
    expect(isCertificateCredentialType('CERTIFICATE')).toBe(true);
    expect(isCertificateCredentialType('MTLS')).toBe(true);
    expect(isCertificateCredentialType('API_KEY')).toBe(false);
    expect(isCertificateCredentialType('JWT')).toBe(false);
  });

  it('the live filter excludes legacy, revoked, expired and past-grace rows', () => {
    expect(liveCertificateCredentialFilter(now)).toEqual({
      tlsAuthMode: { not: null },
      revoked: false,
      AND: [
        { OR: [{ certNotAfter: null }, { certNotAfter: { gt: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ supersededById: null }, { rotationGraceUntil: { gt: now } }] },
      ],
    });
  });
});
