import type {
  NhiCredential,
  NhiIdentity,
  NhiCredentialType,
  Prisma,
} from '@prisma/client';

/**
 * The computed status of an NHI certificate credential. Only `active` and
 * `grace` authenticate.
 *
 * - `identity_inactive`: the identity is disabled or not ACTIVE (a
 *   PROVISIONING, SUSPENDED or DECOMMISSIONED identity authenticates nothing).
 * - `disabled`: the credential is disabled.
 * - `revoked`: the credential is revoked.
 * - `not_yet_valid` / `expired`: outside its certificate's validity window
 *   or past `expiresAt`. A credential superseded by a rotation whose grace
 *   period has ended is `expired` too.
 * - `grace`: superseded by a rotation and still inside `rotationGraceUntil`.
 * - `active`: everything else.
 *
 * The checks run in that order, so the most fundamental reason wins.
 */
export type NhiCredentialStatus =
  | 'active'
  | 'grace'
  | 'revoked'
  | 'expired'
  | 'not_yet_valid'
  | 'disabled'
  | 'identity_inactive';

export type StatusCredential = Pick<
  NhiCredential,
  | 'enabled'
  | 'revoked'
  | 'expiresAt'
  | 'certNotBefore'
  | 'certNotAfter'
  | 'supersededById'
  | 'rotationGraceUntil'
>;

export type StatusIdentity = Pick<NhiIdentity, 'enabled' | 'lifecycleStatus'>;

export function isIdentityActive(identity: StatusIdentity): boolean {
  return identity.enabled && identity.lifecycleStatus === 'ACTIVE';
}

export function nhiCredentialStatus(
  credential: StatusCredential,
  identity: StatusIdentity | null,
  now: Date = new Date(),
): NhiCredentialStatus {
  if (identity && !isIdentityActive(identity)) return 'identity_inactive';
  if (!credential.enabled) return 'disabled';
  if (credential.revoked) return 'revoked';
  const t = now.getTime();
  if (credential.certNotBefore && t < credential.certNotBefore.getTime()) {
    return 'not_yet_valid';
  }
  if (credential.certNotAfter && t > credential.certNotAfter.getTime()) {
    return 'expired';
  }
  if (credential.expiresAt && t > credential.expiresAt.getTime()) {
    return 'expired';
  }
  if (credential.supersededById) {
    return credential.rotationGraceUntil &&
      t < credential.rotationGraceUntil.getTime()
      ? 'grace'
      : 'expired';
  }
  return 'active';
}

export function authenticates(status: NhiCredentialStatus): boolean {
  return status === 'active' || status === 'grace';
}

/** The credential types that hold certificates; they never take a private key. */
export const CERTIFICATE_CREDENTIAL_TYPES: readonly NhiCredentialType[] = [
  'CERTIFICATE',
  'MTLS',
];

export function isCertificateCredentialType(type: NhiCredentialType): boolean {
  return CERTIFICATE_CREDENTIAL_TYPES.includes(type);
}

/** Live certificate credentials one identity may hold (rotation needs two). */
export const MAX_LIVE_CERTIFICATE_CREDENTIALS = 10;

/**
 * Prisma filter for an identity's live certificate credentials: those with a
 * TLS mode that are not revoked, not past their certificate or `expiresAt`,
 * and not superseded past their grace period. Disabled ones count: they can
 * be enabled again.
 */
export function liveCertificateCredentialFilter(
  now: Date,
): Prisma.NhiCredentialWhereInput {
  return {
    tlsAuthMode: { not: null },
    revoked: false,
    AND: [
      { OR: [{ certNotAfter: null }, { certNotAfter: { gt: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      {
        OR: [{ supersededById: null }, { rotationGraceUntil: { gt: now } }],
      },
    ],
  };
}
