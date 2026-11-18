import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { EndedSession } from '../tokens/backchannel-logout.service.js';

/**
 * The `RETURNING` columns of a `DELETE FROM "sessions" AS s` that hands back
 * each deleted session as an `EndedSession`: its id, its user, and the
 * `client_id` of each of its refresh tokens, NULL included (a token issued
 * before refresh tokens recorded their client; see
 * `BackchannelLogoutService.resolveClients`). The subquery sees the refresh
 * tokens the delete is about to cascade away: it runs within the statement's
 * snapshot, and the cascade fires only after the row is deleted.
 */
export const ENDED_SESSION_COLUMNS = Prisma.sql`
  s."id" AS "id", s."user_id" AS "userId",
  ARRAY(SELECT DISTINCT rt."client_id"
          FROM "refresh_tokens" AS rt
         WHERE rt."session_id" = s."id") AS "clientIds"`;

/**
 * Delete these sessions (their refresh tokens go with them, ON DELETE
 * CASCADE) and return the ones this statement actually deleted, with their
 * clients, for back-channel logout. A session another request deleted first
 * is not returned, so it is announced once, by whoever deleted it.
 */
export function deleteSessionsReturning(
  prisma: PrismaService,
  sessionIds: readonly string[],
): Prisma.PrismaPromise<EndedSession[]> {
  return prisma.$queryRaw<EndedSession[]>`
    DELETE FROM "sessions" AS s
     WHERE s."id" = ANY(${[...sessionIds]}::text[])
    RETURNING ${ENDED_SESSION_COLUMNS}`;
}
