import type { PrismaService } from '../prisma/prisma.service.js';
import { ADMIN_TOKEN_TTL_SECONDS } from './admin-token-ttl.js';

/**
 * Ending every admin console token of one admin at once.
 *
 * Console tokens are stateless JWTs, revoked one by one by their `jti` in
 * `admin_revoked_tokens`. When an admin's credentials change (a password set
 * or reset, a second-factor reset, the account disabled), every token they
 * hold must stop working, and their `jti`s are not known. A row keyed
 * `user:<id>` records when that happened: a token of that admin issued
 * (`iat`) before `revokedAt` is refused. The row expires with the last token
 * it can affect, one token lifetime later, and is purged with the others.
 *
 * `validateAdminToken` reads the token's `jti` row and this one in the same
 * query, so the check costs no extra round trip.
 */
export function adminUserRevocationKey(userId: string): string {
  return `user:${userId}`;
}

/**
 * The write that ends every console token `userId` holds now. A Prisma
 * promise, so it can join the caller's transaction.
 */
export function revokeAdminTokensOfUser(
  prisma: Pick<PrismaService, 'adminRevokedToken'>,
  userId: string,
  now: Date = new Date(),
) {
  const jti = adminUserRevocationKey(userId);
  const expiresAt = new Date(now.getTime() + ADMIN_TOKEN_TTL_SECONDS * 1000);
  return prisma.adminRevokedToken.upsert({
    where: { jti },
    create: { jti, revokedAt: now, expiresAt },
    update: { revokedAt: now, expiresAt },
  });
}

/**
 * Whether a token issued at `iat` (seconds) is ended by a user revocation
 * recorded at `revokedAt`. `iat` has whole-second precision, so a token from
 * the same second as the revocation is refused too: ending a token that was
 * issued just after is the safe side of that rounding.
 */
export function issuedBeforeRevocation(
  iat: number | undefined,
  revokedAt: Date,
): boolean {
  if (typeof iat !== 'number') return true;
  return iat <= Math.floor(revokedAt.getTime() / 1000);
}
