import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  isLegacyRecoveryCodeHash,
  RECOVERY_CODE_WRAPPED_PREFIX,
} from './recovery-codes.js';

/** Rows hashed per batch. Each costs one Argon2id hash. */
export const RECOVERY_CODE_REWRAP_BATCH = 50;

/**
 * Protects the stored hashes of recovery codes issued before 0.11.0.
 *
 * Those codes are 8 hex characters (32 bits) stored as an unsalted SHA-256,
 * which anyone holding a copy of the database can reverse in seconds. This
 * replaces each unused one with `rc1a$` + Argon2id(old hash): salted and
 * slow, while the code itself keeps working (MfaService.verifyRecoveryCode
 * checks an 8-hex input against it). Used codes are left: they can never be
 * redeemed again.
 *
 * - Runs in the background after start-up, at every start: an older version
 *   still running during a rolling upgrade can write old-format codes after
 *   a first pass. With nothing to do it costs one query.
 * - Hashing happens outside any transaction; each row is then replaced with
 *   a conditional update on its old hash, so a row redeemed or rewrapped by
 *   another process in the meantime is left alone, and two processes walking
 *   at once only waste work.
 */
@Injectable()
export class RecoveryCodeRewrapService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RecoveryCodeRewrapService.name);
  private running?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {
    // Stop before the pool closes, as AdminEventPurgeService does.
    prisma.onBeforeDisconnect(() => this.onModuleDestroy());
  }

  onApplicationBootstrap(): void {
    this.running = this.run().then(
      (rewrapped) => {
        if (rewrapped > 0) {
          this.logger.log(
            `Rewrapped ${rewrapped} pre-0.11.0 recovery code hash(es) in Argon2id.`,
          );
        }
      },
      (err: Error) => {
        this.logger.error(
          `Rewrapping pre-0.11.0 recovery codes stopped (the next start resumes): ${err.message}`,
        );
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.running;
  }

  /** Rewraps every unused pre-0.11.0 hash. Returns how many it replaced. */
  async run(): Promise<number> {
    let rewrapped = 0;
    let after: string | undefined;
    while (!this.stopping) {
      // Every new format has a prefix ("rc"), an old hash is 64 hex digits.
      const rows = await this.prisma.recoveryCode.findMany({
        where: {
          used: false,
          NOT: { codeHash: { startsWith: 'rc' } },
          ...(after ? { id: { gt: after } } : {}),
        },
        select: { id: true, codeHash: true },
        orderBy: { id: 'asc' },
        take: RECOVERY_CODE_REWRAP_BATCH,
      });
      for (const row of rows) {
        if (this.stopping) break;
        if (!isLegacyRecoveryCodeHash(row.codeHash)) continue;
        const wrapped =
          RECOVERY_CODE_WRAPPED_PREFIX +
          (await this.crypto.hashPassword(row.codeHash));
        const { count } = await this.prisma.recoveryCode.updateMany({
          where: { id: row.id, codeHash: row.codeHash, used: false },
          data: { codeHash: wrapped },
        });
        rewrapped += count;
      }
      if (rows.length < RECOVERY_CODE_REWRAP_BATCH) break;
      after = rows[rows.length - 1].id;
    }
    return rewrapped;
  }
}
