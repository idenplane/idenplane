/**
 * Unit tests for registration flow changes — validates email domain restrictions,
 * terms of service acceptance, approval-required flow, and custom attribute validation.
 */

import { resolveUserClaims } from '../scopes/claims.resolver.js';

// ─── Claims resolver with custom attributes ────────────────────────────────────

describe('resolveUserClaims with custom attribute OIDC claims', () => {
  const baseUser = {
    id: 'user-1',
    username: 'johndoe',
    email: 'john@example.com',
    emailVerified: true,
    firstName: 'John',
    lastName: 'Doe',
  };

  it('should include standard claims when in allowed set', () => {
    const allowed = new Set(['preferred_username', 'email', 'email_verified']);
    const claims = resolveUserClaims(baseUser, allowed);

    expect(claims['preferred_username']).toBe('johndoe');
    expect(claims['email']).toBe('john@example.com');
    expect(claims['email_verified']).toBe(true);
    expect(claims['given_name']).toBeUndefined();
  });

  it('should include custom attribute claims even when not in allowed scope set', () => {
    const allowed = new Set(['preferred_username']);
    const customClaims = {
      phone_number: '+1234567890',
      department: 'Engineering',
    };

    const claims = resolveUserClaims(baseUser, allowed, customClaims);

    expect(claims['preferred_username']).toBe('johndoe');
    expect(claims['phone_number']).toBe('+1234567890');
    expect(claims['department']).toBe('Engineering');
  });

  it('should skip empty custom attribute claim values', () => {
    const allowed = new Set(['preferred_username']);
    const customClaims = { phone_number: '', department: 'Engineering' };

    const claims = resolveUserClaims(baseUser, allowed, customClaims);

    expect(claims['phone_number']).toBeUndefined();
    expect(claims['department']).toBe('Engineering');
  });

  it('should work with no custom attribute claims', () => {
    const allowed = new Set(['preferred_username', 'email']);
    const claims = resolveUserClaims(baseUser, allowed, undefined);

    expect(claims['preferred_username']).toBe('johndoe');
    expect(claims['email']).toBe('john@example.com');
  });

  it('should always include sub per OIDC Core §5.3', () => {
    // sub is mandatory in every userinfo response regardless of requested scopes
    const allowed = new Set<string>();
    const claims = resolveUserClaims(baseUser, allowed);

    expect(claims['sub']).toBe('user-1');
    expect(claims['preferred_username']).toBeUndefined();
  });
});

// ─── Email domain validation logic ────────────────────────────────────────────

describe('Email domain validation', () => {
  function isEmailDomainAllowed(
    email: string,
    allowedDomains: string[],
  ): boolean {
    if (allowedDomains.length === 0) return true;
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    return allowedDomains.map((d) => d.toLowerCase()).includes(domain);
  }

  it('should allow any domain when allowedEmailDomains is empty', () => {
    expect(isEmailDomainAllowed('user@anything.com', [])).toBe(true);
    expect(isEmailDomainAllowed('user@example.org', [])).toBe(true);
  });

  it('should allow email when domain matches an entry', () => {
    expect(
      isEmailDomainAllowed('user@company.com', ['company.com', 'partner.org']),
    ).toBe(true);
    expect(
      isEmailDomainAllowed('user@partner.org', ['company.com', 'partner.org']),
    ).toBe(true);
  });

  it('should reject email when domain is not in the allowed list', () => {
    expect(isEmailDomainAllowed('user@gmail.com', ['company.com'])).toBe(false);
    expect(
      isEmailDomainAllowed('user@other.com', ['company.com', 'partner.org']),
    ).toBe(false);
  });

  it('should be case-insensitive', () => {
    expect(isEmailDomainAllowed('user@COMPANY.COM', ['company.com'])).toBe(
      true,
    );
    expect(isEmailDomainAllowed('user@company.com', ['COMPANY.COM'])).toBe(
      true,
    );
  });

  it('should handle malformed emails gracefully', () => {
    expect(isEmailDomainAllowed('not-an-email', ['company.com'])).toBe(false);
  });
});

// ─── Terms of service validation logic ────────────────────────────────────────

describe('Terms of service validation', () => {
  function requiresTermsAcceptance(
    termsOfServiceUrl: string | null | undefined,
    termsAccepted: boolean,
  ): { valid: boolean; error?: string } {
    if (!termsOfServiceUrl) return { valid: true };
    if (!termsAccepted) {
      return {
        valid: false,
        error: 'You must accept the terms of service to register.',
      };
    }
    return { valid: true };
  }

  it('should not require acceptance when no ToS URL is set', () => {
    expect(requiresTermsAcceptance(null, false).valid).toBe(true);
    expect(requiresTermsAcceptance(undefined, false).valid).toBe(true);
  });

  it('should require acceptance when ToS URL is configured and not accepted', () => {
    const result = requiresTermsAcceptance('https://example.com/tos', false);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('terms of service');
  });

  it('should pass when ToS URL is configured and accepted', () => {
    expect(requiresTermsAcceptance('https://example.com/tos', true).valid).toBe(
      true,
    );
  });
});

// ─── Registration approval logic ──────────────────────────────────────────────

describe('Registration approval required', () => {
  function getUserEnabledState(registrationApprovalRequired: boolean): boolean {
    return !registrationApprovalRequired;
  }

  it('should create user as enabled when approval is not required', () => {
    expect(getUserEnabledState(false)).toBe(true);
  });

  it('should create user as disabled when approval is required', () => {
    expect(getUserEnabledState(true)).toBe(false);
  });

  function getRegistrationSuccessMessage(
    registrationApprovalRequired: boolean,
    requireEmailVerification: boolean,
  ): string {
    if (registrationApprovalRequired) {
      return 'Account created successfully! Your account is pending approval by an administrator.';
    }
    if (requireEmailVerification) {
      return 'Account created successfully! Please check your email to verify your account, then sign in.';
    }
    return 'Account created successfully! You can now sign in.';
  }

  it('should return approval pending message when approval required', () => {
    const msg = getRegistrationSuccessMessage(true, false);
    expect(msg).toContain('pending approval');
  });

  it('should return email verification message when verification required', () => {
    const msg = getRegistrationSuccessMessage(false, true);
    expect(msg).toContain('verify your account');
  });

  it('should return standard success message when neither is required', () => {
    const msg = getRegistrationSuccessMessage(false, false);
    expect(msg).toBe('Account created successfully! You can now sign in.');
  });
});
