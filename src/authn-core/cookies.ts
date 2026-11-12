/** The browser SSO (login) session. */
export const SESSION_COOKIE = 'IDENPLANE_SESSION';

/** A pending second-factor challenge after the first factor succeeded. */
export const MFA_CHALLENGE_COOKIE = 'IDENPLANE_MFA_CHALLENGE';

/** A pending required-MFA enrolment after the first factor succeeded. */
export const MFA_ENROLLMENT_COOKIE = 'IDENPLANE_MFA_ENROLLMENT';

/** A pending SAML AuthnRequest while the user signs in. */
export const SAML_REQUEST_COOKIE = 'IDENPLANE_SAML_REQUEST';
