import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { CryptoService } from '../crypto/crypto.service.js';
import {
  RealmImportService,
  type PreparedRealmImport,
  type RealmImportSummary,
} from '../realms/realm-import.service.js';
import { MASTER_REALM } from '../realms/realm.constants.js';
import { SetupWizardService } from '../setup-wizard/setup-wizard.service.js';
import {
  parseBootstrapFile,
  readBootstrapFile,
  type BootstrapRealm,
} from './bootstrap-file.js';

/** What a start with BOOTSTRAP_FILE did. */
export type BootstrapOutcome =
  /** No BOOTSTRAP_FILE: the setup wizard is left to a person. */
  | { status: 'not-configured' }
  /** The realms were created and the wizard closed, in one transaction. */
  | { status: 'applied'; realms: string[] }
  /** Setup was already completed or skipped: nothing was changed. */
  | { status: 'already-set-up' }
  /** The wizard was never closed, but realms exist: nothing was changed. */
  | { status: 'not-fresh'; existingRealms: string[] };

/** Thrown inside the transaction to roll it back on a set-up instance. */
class InstanceNotFresh extends Error {
  constructor(readonly existingRealms: string[]) {
    super('instance already has realms');
  }
}

/** A realm ready to write: the import plus its users' password hashes. */
interface PreparedRealm {
  realm: BootstrapRealm;
  import: PreparedRealmImport;
  passwordHashes: Map<string, string>;
}

/**
 * Sets up a fresh instance from configuration (BOOTSTRAP_FILE, or
 * BOOTSTRAP_JSON) at its first
 * start, so nobody has to open the setup wizard: it creates the declared
 * realms and closes the wizard, all in one transaction under the wizard's
 * own lock (SetupWizardService.completeUnattended).
 *
 * - Fresh means: setup never completed or skipped, and no realm other than
 *   master. Only then is anything written.
 * - Once applied, every later start finds setup complete and changes
 *   nothing, even if the file changed: bootstrap is not a reconciler.
 * - Replicas and WEB_CONCURRENCY workers starting together serialize on the
 *   lock; one applies, the others find it done.
 * - Any failure throws before the server listens, so the process exits and
 *   is never ready; the transaction leaves nothing half-written, so the
 *   next start tries again from scratch.
 */
@Injectable()
export class InstanceBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InstanceBootstrapService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly realmImport: RealmImportService,
    private readonly wizard: SetupWizardService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.run();
  }

  async run(): Promise<BootstrapOutcome> {
    const source = this.source();
    if (!source) return { status: 'not-configured' };

    let outcome: BootstrapOutcome;
    try {
      outcome = await this.apply(source.read());
    } catch (err) {
      // The message names paths in the document, never values from it.
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Instance bootstrap (${source.name}) failed; nothing was applied and the server will not start: ${reason}`,
        { cause: err },
      );
    }
    const name = source.name;

    switch (outcome.status) {
      case 'applied':
        this.logger.log(
          outcome.realms.length
            ? `Instance bootstrapped from ${name}: created realm(s) ${outcome.realms.map((r) => `'${r}'`).join(', ')}; setup wizard closed`
            : `Instance bootstrapped from ${name}: no realms declared; setup wizard closed`,
        );
        break;
      case 'already-set-up':
        this.logger.log(
          `Setup is already complete; ${name} applies only to a fresh instance and was not applied again`,
        );
        break;
      case 'not-fresh':
        this.logger.warn(
          `${name} was not applied: this instance already has realm(s) ` +
            `${outcome.existingRealms.map((r) => `'${r}'`).join(', ')}, so it is ` +
            'not a fresh instance. Nothing was changed. Bootstrap only sets up ' +
            'a new instance; manage an existing one with the admin API, realm ' +
            `import or the Terraform provider, and remove ${name}.`,
        );
        break;
    }
    return outcome;
  }

  /**
   * Where the bootstrap document comes from: a mounted file (BOOTSTRAP_FILE)
   * or the document itself in an environment variable (BOOTSTRAP_JSON), for
   * a plain `docker run`. Never both.
   */
  private source(): { name: string; read: () => string } | null {
    const file = this.config.get<string>('BOOTSTRAP_FILE')?.trim();
    const json = this.config.get<string>('BOOTSTRAP_JSON')?.trim();
    if (file && json) {
      throw new Error(
        'Instance bootstrap: set BOOTSTRAP_FILE or BOOTSTRAP_JSON, not both; the server will not start',
      );
    }
    if (file)
      return { name: 'BOOTSTRAP_FILE', read: () => readBootstrapFile(file) };
    if (json) return { name: 'BOOTSTRAP_JSON', read: () => json };
    return null;
  }

  private async apply(document: string): Promise<BootstrapOutcome> {
    const plan = parseBootstrapFile(document, {
      env: process.env,
      isSecretHash: (value) => this.crypto.isSecretHash(value),
    });

    // Validation, key generation and hashing happen before the lock.
    const prepared: PreparedRealm[] = [];
    for (const realm of plan.realms) {
      const passwordHashes = new Map<string, string>();
      for (const [username, password] of realm.initialPasswords) {
        passwordHashes.set(username, await this.crypto.hashPassword(password));
      }
      prepared.push({
        realm,
        import: await this.prepareImport(realm),
        passwordHashes,
      });
    }

    const first = plan.realms[0];
    let result:
      | { status: 'applied'; result: RealmImportSummary[] }
      | { status: 'already-complete' };
    try {
      result = await this.wizard.completeUnattended(
        (tx) => this.writeRealms(tx, prepared),
        { realmName: first?.name, realmDisplayName: first?.displayName },
      );
    } catch (err) {
      if (err instanceof InstanceNotFresh) {
        return { status: 'not-fresh', existingRealms: err.existingRealms };
      }
      throw err;
    }
    if (result.status === 'already-complete') {
      return { status: 'already-set-up' };
    }

    await this.realmImport.refreshAfterImport();
    for (const summary of result.result) {
      for (const warning of summary.warnings) {
        this.logger.warn(`Realm '${summary.realmName}': ${warning}`);
      }
    }
    return { status: 'applied', realms: plan.realms.map((r) => r.name) };
  }

  private async prepareImport(
    realm: BootstrapRealm,
  ): Promise<PreparedRealmImport> {
    try {
      return await this.realmImport.prepareV2Import(realm.document);
    } catch (err) {
      throw new Error(`realm '${realm.name}': ${importErrorMessage(err)}`, {
        cause: err,
      });
    }
  }

  /** Runs under the wizard lock, in the transaction that closes it. */
  private async writeRealms(
    tx: Prisma.TransactionClient,
    prepared: PreparedRealm[],
  ): Promise<RealmImportSummary[]> {
    const existing = await tx.realm.findMany({
      where: { name: { not: MASTER_REALM } },
      select: { name: true },
      orderBy: { name: 'asc' },
      take: 10,
    });
    if (existing.length) {
      throw new InstanceNotFresh(existing.map((r) => r.name));
    }

    const summaries: RealmImportSummary[] = [];
    for (const { realm, import: write, passwordHashes } of prepared) {
      let summary: RealmImportSummary;
      try {
        summary = await write.write(tx);
      } catch (err) {
        throw new Error(`realm '${realm.name}': ${importErrorMessage(err)}`, {
          cause: err,
        });
      }
      if (passwordHashes.size) {
        const { id: realmId } = await tx.realm.findUniqueOrThrow({
          where: { name: realm.name },
          select: { id: true },
        });
        for (const [username, passwordHash] of passwordHashes) {
          await tx.user.update({
            where: { realmId_username: { realmId, username } },
            data: { passwordHash, passwordChangedAt: new Date() },
          });
        }
      }
      summaries.push(summary);
    }
    return summaries;
  }
}

/** The import's own message (its 400s list the problems by path). */
function importErrorMessage(err: unknown): string {
  const response = (err as { getResponse?: () => unknown }).getResponse?.();
  if (response && typeof response === 'object' && 'message' in response) {
    const message: unknown = response.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}
