import {
  ACR_MFA,
  ACR_PASSWORD,
  ACR_WEBAUTHN,
  acrStrength,
  amrForFactor,
  amrForSessionAcr,
  amrWithOtp,
  OAUTH_FORM_PARAM_KEYS,
  OAUTH_RELAY_PARAM_KEYS,
  pickOAuthParams,
  resolveRequiredAcr,
  satisfiesAcr,
} from './index.js';

describe('authn-core', () => {
  describe('satisfiesAcr', () => {
    it('accepts an equal or stronger ACR and rejects a weaker one', () => {
      expect(satisfiesAcr(ACR_MFA, ACR_MFA)).toBe(true);
      expect(satisfiesAcr(ACR_WEBAUTHN, ACR_MFA)).toBe(true);
      expect(satisfiesAcr(ACR_PASSWORD, ACR_MFA)).toBe(false);
      expect(satisfiesAcr('urn:unknown', ACR_PASSWORD)).toBe(false);
    });
  });

  describe('resolveRequiredAcr', () => {
    // The pairwise rule OAuthController applied before it became variadic.
    const pairwise = (a: string | null, b: string | null): string | null => {
      if (!a && !b) return null;
      if (!a) return b;
      if (!b) return a;
      return acrStrength(a) >= acrStrength(b) ? a : b;
    };
    const values = [null, '', ACR_PASSWORD, ACR_MFA, ACR_WEBAUTHN, 'urn:x'];

    it('matches the nested pairwise resolution for every combination', () => {
      for (const a of values)
        for (const b of values)
          for (const c of values)
            expect(resolveRequiredAcr(a, b, c)).toBe(
              pairwise(pairwise(a, b), c),
            );
    });

    it('returns null when nothing is required', () => {
      expect(resolveRequiredAcr()).toBeNull();
      expect(resolveRequiredAcr(null, undefined, '')).toBeNull();
    });
  });

  it('derives amr from the session ACR, strongest first', () => {
    expect(amrForSessionAcr(ACR_WEBAUTHN)).toEqual(['hwk']);
    expect(amrForSessionAcr(ACR_MFA)).toEqual(['pwd', 'otp']);
    expect(amrForSessionAcr(ACR_PASSWORD)).toEqual(['pwd']);
  });

  it('appends the second factor to the first-factor methods', () => {
    expect(amrWithOtp(undefined)).toEqual(['pwd', 'otp']);
    expect(amrForFactor([], 'sms')).toEqual(['sms']);
    expect(amrForFactor(['pwd'], 'recovery')).toEqual(['pwd', 'otp']);
  });

  it('picks the non-empty OAuth params in key order', () => {
    const picked = pickOAuthParams(
      { state: 's', client_id: 'app', nonce: '', extra: 'x' },
      OAUTH_FORM_PARAM_KEYS,
    );
    expect(Object.entries(picked)).toEqual([
      ['client_id', 'app'],
      ['state', 's'],
    ]);
    expect(OAUTH_RELAY_PARAM_KEYS).toEqual([
      ...OAUTH_FORM_PARAM_KEYS,
      'prompt',
      'acr_values',
      'login_hint',
    ]);
  });
});
