import { ACR_MFA, ACR_PASSWORD, ACR_WEBAUTHN } from './acr.js';
import {
  acrFromClaimsParam,
  acrFromReceipts,
  amrFromReceipts,
  computeTargetAcr,
  meetsAcr,
} from './flow-assurance.js';
import {
  LEGACY_SESSION_PROOF,
  STEP_ENDPOINT,
  isMintedFlowSessionProof,
  mintFlowSessionProof,
  type Receipt,
} from './flow-contracts.js';

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

describe('flow contracts', () => {
  it('maps password and ldap to the password endpoint', () => {
    expect(STEP_ENDPOINT).toEqual({
      password: 'password',
      ldap: 'password',
      totp: 'totp',
      webauthn: 'webauthn',
    });
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
