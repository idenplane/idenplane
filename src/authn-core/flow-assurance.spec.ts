import { ACR_MFA, ACR_PASSWORD, ACR_WEBAUTHN } from './acr.js';
import {
  RECEIPT_FACTOR,
  acrFromClaimsParam,
  acrFromReceipts,
  amrFromReceipts,
  computeTargetAcr,
  essentialAcrFromClaimsParam,
  meetsAcr,
  meetsEssentialAcr,
} from './flow-assurance.js';
import {
  IDENTIFYING_STEP_TYPES,
  LEGACY_SESSION_PROOF,
  STEP_AMR,
  STEP_ENDPOINT,
  isIdentifyingType,
  isMintedFlowSessionProof,
  mintFlowSessionProof,
  type FlowStepType,
  type Receipt,
} from './flow-contracts.js';
import {
  ENFORCE_ACR_ON_FRESH_LOGIN_ENV,
  isEnforceAcrOnFreshLoginEnabled,
} from './acr-enforcement.js';

const r = (kind: Receipt['kind'], amr: string[], stepId = kind): Receipt => ({
  stepId,
  kind,
  amr,
  at: '2026-11-13T00:00:00.000Z',
});

describe('receipts → ACR / AMR', () => {
  it('a password alone is the password level', () => {
    const receipts = [r('password', ['pwd'])];
    expect(acrFromReceipts(receipts)).toBe(ACR_PASSWORD);
    expect(amrFromReceipts(receipts)).toEqual(['pwd']);
  });

  it('a password and an authenticator code is MFA', () => {
    const receipts = [r('password', ['pwd']), r('totp', ['otp'])];
    expect(acrFromReceipts(receipts)).toBe(ACR_MFA);
    expect(amrFromReceipts(receipts)).toEqual(['pwd', 'otp']);
  });

  it('a texted code is recorded as sms', () => {
    const receipts = [r('ldap', ['pwd']), r('totp', ['sms'])];
    expect(acrFromReceipts(receipts)).toBe(ACR_MFA);
    expect(amrFromReceipts(receipts)).toEqual(['pwd', 'sms']);
  });

  it('a passkey is the WebAuthn level, alone or with more', () => {
    expect(acrFromReceipts([r('webauthn', ['hwk'])])).toBe(ACR_WEBAUTHN);
    expect(
      acrFromReceipts([r('password', ['pwd']), r('webauthn', ['hwk'])]),
    ).toBe(ACR_WEBAUTHN);
    expect(
      amrFromReceipts([r('webauthn', ['hwk']), r('totp', ['otp'])]),
    ).toEqual(['hwk', 'otp']);
  });

  it('an MFA enrolment counts as the second factor', () => {
    const receipts = [r('password', ['pwd']), r('enrolment', ['otp'])];
    expect(acrFromReceipts(receipts)).toBe(ACR_MFA);
  });

  it('proves nothing without a first factor', () => {
    expect(acrFromReceipts([])).toBeNull();
    expect(acrFromReceipts([r('totp', ['otp'])])).toBeNull();
  });

  it('an emailed code after a password is MFA, recorded as otp', () => {
    const receipts = [
      r('password', [...STEP_AMR.password]),
      r('email_otp', [...STEP_AMR.email_otp]),
    ];
    expect(acrFromReceipts(receipts)).toBe(ACR_MFA);
    expect(amrFromReceipts(receipts)).toEqual(['pwd', 'otp']);
  });

  it('a sign-in link identifies at the password level', () => {
    const receipts = [r('magic_link', [...STEP_AMR.magic_link])];
    expect(acrFromReceipts(receipts)).toBe(ACR_PASSWORD);
    expect(amrFromReceipts(receipts)).toEqual(['otp']);
  });

  it('a sign-in link and an emailed code are one factor (one mailbox)', () => {
    expect(
      acrFromReceipts([r('magic_link', ['otp']), r('email_otp', ['otp'])]),
    ).toBe(ACR_PASSWORD);
  });

  it('a sign-in link and an authenticator code are MFA', () => {
    expect(
      acrFromReceipts([r('magic_link', ['otp']), r('totp', ['otp'])]),
    ).toBe(ACR_MFA);
  });

  it('a social sign-in identifies at the password level with no methods', () => {
    const receipts = [r('social', [...STEP_AMR.social])];
    expect(acrFromReceipts(receipts)).toBe(ACR_PASSWORD);
    expect(amrFromReceipts(receipts)).toEqual([]);
    expect(acrFromReceipts([...receipts, r('totp', ['otp'])])).toBe(ACR_MFA);
  });

  it('two identifying steps are not MFA (password and social, password and link)', () => {
    expect(acrFromReceipts([r('password', ['pwd']), r('social', [])])).toBe(
      ACR_PASSWORD,
    );
    expect(
      acrFromReceipts([r('password', ['pwd']), r('magic_link', ['otp'])]),
    ).toBe(ACR_PASSWORD);
  });

  it('a password and an LDAP password are one factor', () => {
    expect(acrFromReceipts([r('password', ['pwd']), r('ldap', ['pwd'])])).toBe(
      ACR_PASSWORD,
    );
  });

  it('an emailed code alone proves nothing', () => {
    expect(acrFromReceipts([r('email_otp', ['otp'])])).toBeNull();
  });

  it('does not repeat a method', () => {
    expect(
      amrFromReceipts([
        r('password', ['pwd'], 'a'),
        r('password', ['pwd'], 'b'),
        r('totp', ['otp']),
      ]),
    ).toEqual(['pwd', 'otp']);
  });
});

describe('target ACR', () => {
  const none = {
    requested: [],
    clientRequiredAcr: null,
    riskFloor: null,
    riskAcr: null,
    mfaRequired: false,
  };

  it('is nothing when nothing is required', () => {
    expect(computeTargetAcr(none)).toEqual({ target: null, mandatory: null });
  });

  it('takes the strongest of requested, risk floor, risk and MFA', () => {
    expect(
      computeTargetAcr({ ...none, requested: [ACR_PASSWORD], riskAcr: ACR_MFA })
        .target,
    ).toBe(ACR_MFA);
    expect(
      computeTargetAcr({ ...none, riskFloor: ACR_WEBAUTHN, mfaRequired: true })
        .target,
    ).toBe(ACR_WEBAUTHN);
    expect(
      computeTargetAcr({ ...none, requested: [null, ACR_WEBAUTHN] }).target,
    ).toBe(ACR_WEBAUTHN);
  });

  it('makes the MFA rule and the client requirement mandatory, the rest not', () => {
    expect(computeTargetAcr({ ...none, mfaRequired: true })).toEqual({
      target: ACR_MFA,
      mandatory: ACR_MFA,
    });
    expect(
      computeTargetAcr({ ...none, clientRequiredAcr: ACR_WEBAUTHN }),
    ).toEqual({ target: ACR_WEBAUTHN, mandatory: ACR_WEBAUTHN });
    expect(
      computeTargetAcr({
        ...none,
        requested: [ACR_WEBAUTHN],
        riskAcr: ACR_MFA,
      }),
    ).toEqual({ target: ACR_WEBAUTHN, mandatory: null });
  });

  it('meetsAcr compares against the target', () => {
    expect(meetsAcr(ACR_MFA, ACR_MFA)).toBe(true);
    expect(meetsAcr(ACR_PASSWORD, ACR_MFA)).toBe(false);
    expect(meetsAcr(ACR_WEBAUTHN, ACR_MFA)).toBe(true);
    expect(meetsAcr(null, null)).toBe(false);
    expect(meetsAcr(ACR_PASSWORD, null)).toBe(true);
  });

  it('reads the acr of the claims parameter', () => {
    expect(
      acrFromClaimsParam(
        JSON.stringify({
          id_token: { acr: { essential: true, value: ACR_MFA } },
        }),
      ),
    ).toBe(ACR_MFA);
    expect(
      acrFromClaimsParam(
        JSON.stringify({
          userinfo: { acr: { values: [ACR_WEBAUTHN, ACR_MFA] } },
        }),
      ),
    ).toBe(ACR_WEBAUTHN);
    expect(acrFromClaimsParam('{not json')).toBeNull();
    expect(acrFromClaimsParam(undefined)).toBeNull();
    expect(acrFromClaimsParam('{"id_token":{"email":null}}')).toBeNull();
  });
});

describe('essential acr (claims parameter)', () => {
  const claims = (acr: Record<string, unknown>, section = 'id_token') =>
    JSON.stringify({ [section]: { acr } });

  it('is null when acr is not essential', () => {
    expect(essentialAcrFromClaimsParam(undefined)).toBeNull();
    expect(essentialAcrFromClaimsParam('{oops')).toBeNull();
    expect(
      essentialAcrFromClaimsParam(claims({ values: [ACR_MFA] })),
    ).toBeNull();
    expect(
      essentialAcrFromClaimsParam(claims({ value: ACR_MFA, essential: 'yes' })),
    ).toBeNull();
  });

  it('takes the weakest known requested value', () => {
    expect(
      essentialAcrFromClaimsParam(
        claims({ essential: true, values: [ACR_WEBAUTHN, ACR_MFA, 'x:y'] }),
      ),
    ).toEqual({ kind: 'acr', acr: ACR_MFA });
    expect(
      essentialAcrFromClaimsParam(
        claims({ essential: true, value: ACR_WEBAUTHN }, 'userinfo'),
      ),
    ).toEqual({ kind: 'acr', acr: ACR_WEBAUTHN });
  });

  it('is any level when essential names no value', () => {
    expect(essentialAcrFromClaimsParam(claims({ essential: true }))).toEqual({
      kind: 'acr',
      acr: ACR_PASSWORD,
    });
  });

  it('cannot be met when only unknown values are requested', () => {
    const unknown = essentialAcrFromClaimsParam(
      claims({ essential: true, values: ['urn:other:gold'] }),
    );
    expect(unknown).toEqual({ kind: 'unsupported' });
    expect(meetsEssentialAcr(ACR_WEBAUTHN, unknown)).toBe(false);
  });

  it('is met by the same or a stronger level only', () => {
    const mfa = { kind: 'acr', acr: ACR_MFA } as const;
    expect(meetsEssentialAcr(ACR_MFA, mfa)).toBe(true);
    expect(meetsEssentialAcr(ACR_WEBAUTHN, mfa)).toBe(true);
    expect(meetsEssentialAcr(ACR_PASSWORD, mfa)).toBe(false);
    expect(meetsEssentialAcr(null, mfa)).toBe(false);
    expect(meetsEssentialAcr('urn:other:gold', mfa)).toBe(false);
    expect(meetsEssentialAcr(ACR_PASSWORD, null)).toBe(true);
  });

  it('makes an enforced essential acr part of the mandatory target', () => {
    expect(
      computeTargetAcr({
        requested: [],
        clientRequiredAcr: null,
        riskFloor: null,
        riskAcr: null,
        mfaRequired: false,
        essentialAcr: ACR_WEBAUTHN,
      }),
    ).toEqual({ target: ACR_WEBAUTHN, mandatory: ACR_WEBAUTHN });
  });

  it('reads the switch exactly as true', () => {
    const env = (v?: string) => ({ [ENFORCE_ACR_ON_FRESH_LOGIN_ENV]: v });
    expect(isEnforceAcrOnFreshLoginEnabled(env())).toBe(false);
    expect(isEnforceAcrOnFreshLoginEnabled(env('1'))).toBe(false);
    expect(isEnforceAcrOnFreshLoginEnabled(env(' TRUE '))).toBe(true);
  });
});

describe('flow contracts', () => {
  it('maps each step type to its endpoint', () => {
    expect(STEP_ENDPOINT).toEqual({
      password: 'password',
      ldap: 'password',
      totp: 'totp',
      webauthn: 'webauthn',
      email_otp: 'email_otp',
      magic_link: 'magic_link',
      social: 'social',
    });
  });

  it('agrees on every step type: identifying, AMR and factor', () => {
    const types = Object.keys(STEP_ENDPOINT) as FlowStepType[];
    const expected: Record<
      FlowStepType,
      { identifying: boolean; amr: string[]; acrAlone: string | null }
    > = {
      password: { identifying: true, amr: ['pwd'], acrAlone: ACR_PASSWORD },
      ldap: { identifying: true, amr: ['pwd'], acrAlone: ACR_PASSWORD },
      webauthn: { identifying: true, amr: ['hwk'], acrAlone: ACR_WEBAUTHN },
      magic_link: { identifying: true, amr: ['otp'], acrAlone: ACR_PASSWORD },
      social: { identifying: true, amr: [], acrAlone: ACR_PASSWORD },
      totp: { identifying: false, amr: ['otp'], acrAlone: null },
      email_otp: { identifying: false, amr: ['otp'], acrAlone: null },
    };
    for (const type of types) {
      expect([type, isIdentifyingType(type)]).toEqual([
        type,
        expected[type].identifying,
      ]);
      expect([type, IDENTIFYING_STEP_TYPES.includes(type)]).toEqual([
        type,
        expected[type].identifying,
      ]);
      expect([type, [...STEP_AMR[type]]]).toEqual([type, expected[type].amr]);
      expect([type, RECEIPT_FACTOR[type]]).toEqual([type, expect.any(String)]);
      expect([type, acrFromReceipts([r(type, [...STEP_AMR[type]])])]).toEqual([
        type,
        expected[type].acrAlone,
      ]);
    }
  });

  it('accepts only proofs it minted', () => {
    const fields = {
      txnId: 't',
      realmId: 'r',
      userId: 'u',
      flowId: 'f',
      flowVersion: 1,
    };
    expect(isMintedFlowSessionProof(mintFlowSessionProof(fields))).toBe(true);
    expect(isMintedFlowSessionProof({ kind: 'flow', ...fields })).toBe(false);
    expect(isMintedFlowSessionProof(LEGACY_SESSION_PROOF)).toBe(false);
  });
});
