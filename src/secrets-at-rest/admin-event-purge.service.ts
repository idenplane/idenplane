import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { redactAdminRepresentation } from '../events/admin-event-redaction.js';

/** The row of this task in maintenance_tasks. */
export const ADMIN_EVENT_PURGE_TASK = 'admin-events-redaction';

/**
 * The redaction older rows are brought to. Raise it when
 * redactAdminRepresentation learns a new secret, so that every row is read
 * again once.
 */
export const ADMIN_EVENT_PURGE_VERSION = 1;

/** Admin events read (and at most rewritten) per transaction. */
export const ADMIN_EVENT_PURGE_BATCH = 1000;

/** The advisory lock each batch takes (an arbitrary constant). */
export const ADMIN_EVENT_PURGE_LOCK_KEY = 7_204_311_864;

const TX_OPTIONS = { maxWait: 60_000, timeout: 120_000 };

type Tx = Prisma.TransactionClient;

export interface PurgeResult {
  /** Rows read by this run. */
  scanned: number;
  /** Rows rewritten by this run. */
  redacted: number;
  /** The task had already completed at this version; nothing was read. */
  alreadyDone: boolean;
}

/**
 * Removes the secrets that admin events recorded in plaintext before their
 * redaction covered them: LDAP bind credentials, audit stream headers,
 * organization SSO secrets, email and SMS provider credentials, CAPTCHA
 * secrets, webhook signing secrets, NHI private keys and SCIM passwords.
 * It applies redactAdminRepresentation, which every new event goes through.
 *
 * - It walks admin_events by primary key (its index), ADMIN_EVENT_PURGE_BATCH
 *   rows per transaction, each under an advisory lock, and rewrites only
 *   the rows whose representation changes; the other columns are not
 *   touched. No transaction spans more than one batch.
 * - The last id is kept in maintenance_tasks after every batch, so a
 *   restart resumes there, and several processes share the walk. When it
 *   completes, the row records the version, and later starts read one row.
 * - Redaction is idempotent, so a batch done twice writes nothing more.
 *
 * It runs after the application has started rather than delaying it: the
 * rows are only readable by those who can read the database or the admin
 * events API already, and the walk can take a while on a large table.
 * Rows an older version still running writes during a rolling upgrade, at
 * ids the walk has passed, are left; raise ADMIN_EVENT_PURGE_VERSION to
 * walk again.
 */
@Injectable()
export class AdminEventPurgeService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AdminEventPurgeService.name);
  private running?: Promise<void>;
  private stopping = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    this.running = this.run().then(
      (result) => {
        if (result.redacted > 0) {
          this.logger.log(
            `Removed recorded secrets from ${result.redacted} older admin event(s) (${result.scanned} read).`,
          );
        }
      },
      (err: Error) => {
        this.logger.error(
          `Removing recorded secrets from older admin events stopped (the next start resumes): ${err.message}`,
        );
      },
    );
  }

  /** Lets an in-flight batch finish before the connection pool closes. */
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.running;
  }

  /** The whole task, or what is left of it. */
  async run(): Promise<PurgeResult> {
    const result: PurgeResult = { scanned: 0, redacted: 0, alreadyDone: false };
    while (!this.stopping) {
      const step = await this.prisma.$transaction(
        (tx) => this.batch(tx, result),
        TX_OPTIONS,
      );
      if (step === 'already-done') {
        result.alreadyDone = result.scanned === 0;
        break;
      }
      if (step === 'finished') break;
    }
    return result;
  }

  /** One batch: read, redact, rewrite, and move the cursor. */
  private async batch(
    tx: Tx,
    result: PurgeResult,
  ): Promise<'more' | 'finished' | 'already-done'> {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(${ADMIN_EVENT_PURGE_LOCK_KEY})`,
    );
    const task = await tx.maintenanceTask.findUnique({
      where: { id: ADMIN_EVENT_PURGE_TASK },
    });
    if (task && task.completedVersion >= ADMIN_EVENT_PURGE_VERSION) {
      return 'already-done';
    }
    // A walk of an older version starts over.
    const cursor =
      task?.cursor && task.cursorVersion === ADMIN_EVENT_PURGE_VERSION
        ? task.cursor
        : undefined;

    const rows = await tx.adminEvent.findMany({
      where: {
        representation: { not: Prisma.DbNull },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, representation: true },
      orderBy: { id: 'asc' },
      take: ADMIN_EVENT_PURGE_BATCH,
    });

    const changed: Array<{ id: string; representation: string }> = [];
    for (const row of rows) {
      const before = JSON.stringify(row.representation);
      const after = JSON.stringify(
        redactAdminRepresentation(row.representation),
      );
      if (after !== before) changed.push({ id: row.id, representation: after });
    }
    if (changed.length > 0) {
      const values = Prisma.join(
        changed.map(
          (c) => Prisma.sql`(${c.id}::text, ${c.representation}::jsonb)`,
        ),
      );
      result.redacted += await tx.$executeRaw`
        UPDATE "admin_events" AS t
           SET "representation" = v.representation
          FROM (VALUES ${values}) AS v(id, representation)
         WHERE t.id = v.id`;
    }
    result.scanned += rows.length;

    const finished = rows.length < ADMIN_EVENT_PURGE_BATCH;
    const progress = finished
      ? {
          completedVersion: ADMIN_EVENT_PURGE_VERSION,
          cursor: null,
          cursorVersion: ADMIN_EVENT_PURGE_VERSION,
        }
      : {
          cursor: rows[rows.length - 1].id,
          cursorVersion: ADMIN_EVENT_PURGE_VERSION,
        };
    await tx.maintenanceTask.upsert({
      where: { id: ADMIN_EVENT_PURGE_TASK },
      create: { id: ADMIN_EVENT_PURGE_TASK, ...progress },
      update: progress,
    });
    return finished ? 'finished' : 'more';
  }
}
