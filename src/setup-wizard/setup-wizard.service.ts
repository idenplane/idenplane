import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WizardState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { seedDefaultScopesIn } from '../scopes/scope-seed.service.js';
import { signingKeySecrets } from '../crypto/signing-key-secrets.js';
import { wizardSecrets } from './wizard-secrets.js';

/** The answer to any wizard write once setup is completed or skipped. */
export const SETUP_COMPLETE_MESSAGE = 'Setup is already complete';

function setupComplete(): ConflictException {
  return new ConflictException(SETUP_COMPLETE_MESSAGE);
}

export interface WizardStatus {
  isFirstRun: boolean;
  wizardCompleted: boolean;
  wizardSkipped: boolean;
  currentStep: number;
  totalSteps: number;
  steps: WizardStepInfo[];
}

export interface WizardStepInfo {
  index: number;
  name: string;
  description: string;
  completed: boolean;
  required: boolean;
}

export interface SaveAdminAccountDto {
  username: string;
  email: string;
  password: string;
}

export interface SaveRealmSettingsDto {
  name: string;
  displayName?: string;
}

export interface SaveSmtpConfigDto {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  secure?: boolean;
}

export interface SaveClientDto {
  clientId: string;
  redirectUris: string[];
}

const WIZARD_STEPS = [
  {
    name: 'Admin Account',
    description: 'Create your admin account',
    required: true,
  },
  {
    name: 'Realm Settings',
    description: 'Configure your master realm',
    required: true,
  },
  {
    name: 'SMTP Configuration',
    description: 'Set up email notifications (optional)',
    required: false,
  },
  {
    name: 'Client Application',
    description: 'Create your first client application',
    required: true,
  },
  {
    name: 'SDK Integration',
    description: 'View integration code',
    required: false,
  },
  {
    name: 'Test Authentication',
    description: 'Verify your setup works',
    required: false,
  },
] as const;

/** The id of the one wizard state row created from now on. */
const WIZARD_STATE_ID = 'wizard';

/**
 * Completing creates a realm with a signing key, roles, a user and the
 * default scopes in one transaction; give it more than Prisma's 5s default.
 */
const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

/**
 * The first-run setup wizard.
 *
 * Every write runs under the wizard state row's lock and is refused with 409
 * once setup is completed or skipped, so the wizard can never be used to
 * create a realm or an admin on an instance that is already set up. Access
 * control (super-admin only) is the controller's job.
 */
@Injectable()
export class SetupWizardService {
  private readonly logger = new Logger(SetupWizardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwkService: JwkService,
  ) {}

  /**
   * Check if this is the first run (no realms exist and wizard not completed/skipped)
   */
  async isFirstRun(): Promise<boolean> {
    const realmCount = await this.prisma.realm.count();
    if (realmCount > 0) {
      return false;
    }

    const wizardState = await this.getWizardState();
    return !wizardState.completed && !wizardState.skipped;
  }

  /**
   * Get wizard status including step information
   */
  async getWizardStatus(): Promise<WizardStatus> {
    const wizardState = await this.getWizardState();
    const realmCount = await this.prisma.realm.count();

    const isFirstRun =
      realmCount === 0 && !wizardState.completed && !wizardState.skipped;

    const steps: WizardStepInfo[] = WIZARD_STEPS.map((step, index) => ({
      index,
      name: step.name,
      description: step.description,
      completed: index < wizardState.currentStep,
      required: step.required,
    }));

    return {
      isFirstRun,
      wizardCompleted: wizardState.completed,
      wizardSkipped: wizardState.skipped,
      currentStep: wizardState.currentStep,
      totalSteps: WIZARD_STEPS.length,
      steps,
    };
  }

  /**
   * Get or create wizard state
   */
  async getWizardState(): Promise<WizardState> {
    let state = await this.prisma.wizardState.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (!state) {
      // A fixed id, so two first requests at once (or two instances) cannot
      // create two states: the second insert conflicts and reads the first.
      try {
        state = await this.prisma.wizardState.create({
          data: {
            id: WIZARD_STATE_ID,
            completed: false,
            skipped: false,
            currentStep: 0,
          },
        });
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
        state = await this.prisma.wizardState.findUniqueOrThrow({
          where: { id: WIZARD_STATE_ID },
        });
      }
    }

    return state;
  }

  /** Throws 409 once setup is completed or skipped. */
  private assertOpen(state: WizardState): void {
    if (state.completed || state.skipped) throw setupComplete();
  }

  /**
   * Runs one wizard write in a transaction that holds the state row's lock
   * and has checked, under that lock, that setup is still open. Completing
   * and skipping take the same lock, so a write can never land after or
   * interleave with them: whichever comes second sees the flag and gets 409.
   */
  private async withOpenState<T>(
    write: (tx: Prisma.TransactionClient, state: WizardState) => Promise<T>,
  ): Promise<T> {
    const { id } = await this.getWizardState();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "wizard_states" WHERE "id" = ${id} FOR UPDATE`;
      const state = await tx.wizardState.findUniqueOrThrow({ where: { id } });
      this.assertOpen(state);
      return write(tx, state);
    }, TX_OPTIONS);
  }

  /**
   * Save admin account credentials (Step 1)
   */
  async saveAdminAccount(dto: SaveAdminAccountDto): Promise<WizardState> {
    // Checked first, so a closed wizard answers 409 whatever the input.
    this.assertOpen(await this.getWizardState());
    this.validateAdminAccount(dto);

    const passwordHash = await this.crypto.hashPassword(dto.password);

    return this.withOpenState((tx, state) =>
      tx.wizardState.update({
        where: { id: state.id },
        data: {
          adminUsername: dto.username,
          adminEmail: dto.email,
          adminPasswordHash: passwordHash,
          currentStep: Math.max(state.currentStep, 1),
        },
      }),
    );
  }

  /**
   * Save realm settings (Step 2)
   */
  async saveRealmSettings(dto: SaveRealmSettingsDto): Promise<WizardState> {
    this.assertOpen(await this.getWizardState());
    this.validateRealmSettings(dto);

    return this.withOpenState(async (tx, state) => {
      const existing = await tx.realm.findUnique({
        where: { name: dto.name },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException(`Realm '${dto.name}' already exists`);
      }

      return tx.wizardState.update({
        where: { id: state.id },
        data: {
          realmName: dto.name,
          realmDisplayName: dto.displayName,
          currentStep: Math.max(state.currentStep, 2),
        },
      });
    });
  }

  /**
   * Save SMTP configuration (Step 3)
   */
  async saveSmtpConfig(dto: SaveSmtpConfigDto): Promise<WizardState> {
    this.assertOpen(await this.getWizardState());
    this.validateSmtpConfig(dto);

    return this.withOpenState((tx, state) =>
      tx.wizardState.update({
        where: { id: state.id },
        data: {
          smtpConfig: {
            host: dto.host,
            port: dto.port,
            user: dto.user,
            // Encrypted at rest; completeWizard copies it into the realm as is.
            password: wizardSecrets.smtpPassword(
              this.crypto,
              dto.password,
              state.smtpConfig,
            ),
            from: dto.from,
            secure: dto.secure,
          },
          currentStep: Math.max(state.currentStep, 3),
        },
      }),
    );
  }

  /**
   * Checks the saved SMTP settings (Step 3). Only while setup is open: once
   * it is done, the realm-level SMTP test in the admin API takes over. It
   * uses the stored settings only and sends nothing.
   */
  async testSmtp(): Promise<{ message: string; host: unknown; port: unknown }> {
    const state = await this.getWizardState();
    this.assertOpen(state);

    const smtpConfig = state.smtpConfig as Record<string, unknown> | null;
    if (!smtpConfig || !smtpConfig['host'] || !smtpConfig['port']) {
      throw new BadRequestException(
        'SMTP is not configured. Please save SMTP config first.',
      );
    }

    return {
      message: 'SMTP configuration appears valid',
      host: smtpConfig['host'],
      port: smtpConfig['port'],
    };
  }

  /**
   * Save client application (Step 4)
   */
  async saveClient(
    dto: SaveClientDto,
  ): Promise<WizardState & { clientSecret: string }> {
    this.assertOpen(await this.getWizardState());
    this.validateClientConfig(dto);

    // Generate client secret. Only its hash is stored, as for any client;
    // the plaintext goes back in this response once and is never persisted.
    const clientSecret = this.crypto.generateSecret();
    const clientSecretHash = await this.crypto.hashSecret(clientSecret);

    const updated = await this.withOpenState(async (tx, state) => {
      if (!state.realmName) {
        throw new BadRequestException(
          'Realm must be created before adding a client',
        );
      }

      const realm = await tx.realm.findUnique({
        where: { name: state.realmName },
      });
      if (!realm) {
        throw new BadRequestException(
          'Realm not found. Please complete Step 2 first.',
        );
      }

      const existingClient = await tx.client.findUnique({
        where: {
          realmId_clientId: { realmId: realm.id, clientId: dto.clientId },
        },
        select: { id: true },
      });
      if (existingClient) {
        throw new BadRequestException(
          `Client '${dto.clientId}' already exists in realm '${realm.name}'`,
        );
      }

      await tx.client.create({
        data: {
          realmId: realm.id,
          clientId: dto.clientId,
          clientSecret: clientSecretHash,
          clientType: 'CONFIDENTIAL',
          name: dto.clientId,
          enabled: true,
          redirectUris: dto.redirectUris,
          grantTypes: ['authorization_code'],
        },
      });

      return tx.wizardState.update({
        where: { id: state.id },
        data: {
          clientId: dto.clientId,
          redirectUris: dto.redirectUris,
          currentStep: Math.max(state.currentStep, 4),
        },
      });
    });
    return { ...updated, clientSecret };
  }

  /**
   * Mark SDK step as completed (Step 5)
   */
  async markSdkGenerated(): Promise<WizardState> {
    return this.withOpenState((tx, state) =>
      tx.wizardState.update({
        where: { id: state.id },
        data: {
          sdkGenerated: true,
          currentStep: Math.max(state.currentStep, 5),
        },
      }),
    );
  }

  /**
   * Complete the wizard and finalize the setup.
   *
   * One transaction under the state row's lock: it checks that setup is
   * still open, creates the realm, its roles, the admin and the default
   * scopes, and marks the wizard completed. Two completions at once
   * serialize on the lock; the second sees `completed` and gets 409, and a
   * failure anywhere rolls everything back.
   */
  async completeWizard(): Promise<{ success: boolean; message: string }> {
    const before = await this.getWizardState();
    this.assertOpen(before);
    this.assertCompletable(before);

    // The slow part happens before the lock is taken.
    const keyPair = await this.jwkService.generateRsaKeyPair();

    let created: { realmName: string; adminUsername: string };
    try {
      created = await this.withOpenState(async (tx, state) => {
        // Checked again under the lock: the answers may have changed.
        const { realmName, adminUsername, adminPasswordHash } =
          this.assertCompletable(state);

        const smtpConfig = state.smtpConfig as Record<string, unknown> | null;
        const smtpData = smtpConfig
          ? {
              smtpHost: smtpConfig['host'] as string,
              smtpPort: smtpConfig['port'] as number,
              smtpUser: smtpConfig['user'] as string,
              // Already encrypted by saveSmtpConfig; encryptSecret leaves
              // ciphertext as it is and encrypts a password saved before that.
              smtpPassword: this.crypto.encryptSecret(
                smtpConfig['password'] as string | undefined,
              ),
              smtpFrom: smtpConfig['from'] as string,
              smtpSecure: smtpConfig['secure'] as boolean,
            }
          : {};

        const realm = await tx.realm.create({
          data: {
            name: realmName,
            displayName: state.realmDisplayName || realmName,
            enabled: true,
            ...smtpData,
            signingKeys: {
              create: signingKeySecrets.createData(this.crypto, keyPair),
            },
          },
        });

        const superAdmin = await tx.role.create({
          data: {
            realmId: realm.id,
            name: 'super-admin',
            description: 'Full access to all realms and settings',
          },
        });
        await tx.role.create({
          data: {
            realmId: realm.id,
            name: 'realm-admin',
            description: 'Manage specific realms',
          },
        });
        await tx.role.create({
          data: {
            realmId: realm.id,
            name: 'view-only',
            description: 'Read-only access',
          },
        });

        const adminUser = await tx.user.create({
          data: {
            realmId: realm.id,
            username: adminUsername,
            email: state.adminEmail,
            enabled: true,
            passwordHash: adminPasswordHash,
            passwordChangedAt: new Date(),
          },
        });
        await tx.userRole.create({
          data: { userId: adminUser.id, roleId: superAdmin.id },
        });

        await seedDefaultScopesIn(tx, realm.id);

        await tx.wizardState.update({
          where: { id: state.id },
          data: { completed: true, currentStep: WIZARD_STEPS.length },
        });

        return { realmName: realm.name, adminUsername };
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          `Realm '${before.realmName}' already exists`,
        );
      }
      throw err;
    }

    this.logger.log(
      `Wizard completed. Realm '${created.realmName}' created with admin user '${created.adminUsername}'`,
    );

    return {
      success: true,
      message: `Setup completed successfully. Realm '${created.realmName}' created with admin user '${created.adminUsername}'`,
    };
  }

  /** The answers completing needs, or 400 naming the missing step. */
  private assertCompletable(state: WizardState): {
    realmName: string;
    adminUsername: string;
    adminPasswordHash: string;
  } {
    if (!state.adminUsername || !state.adminPasswordHash) {
      throw new BadRequestException(
        'Admin account must be created before completing the wizard',
      );
    }
    if (!state.realmName) {
      throw new BadRequestException(
        'Realm must be created before completing the wizard',
      );
    }
    return {
      realmName: state.realmName,
      adminUsername: state.adminUsername,
      adminPasswordHash: state.adminPasswordHash,
    };
  }

  /**
   * Skip the wizard (for advanced users). Final, like completing it.
   */
  async skipWizard(): Promise<WizardState> {
    return this.withOpenState((tx, state) =>
      tx.wizardState.update({
        where: { id: state.id },
        data: { skipped: true },
      }),
    );
  }

  /**
   * Clears the answers of a wizard that is still in progress.
   *
   * It only ever touches the wizard's own state row, never realms, users or
   * clients. Once setup is completed or skipped it is refused with 409 like
   * every other write: resetting a finished wizard would reopen it and let
   * it create another realm and admin.
   */
  async resetWizard(): Promise<WizardState> {
    return this.withOpenState((tx, state) =>
      tx.wizardState.update({
        where: { id: state.id },
        data: {
          currentStep: 0,
          adminUsername: null,
          adminEmail: null,
          adminPasswordHash: null,
          realmName: null,
          realmDisplayName: null,
          smtpConfig: Prisma.DbNull,
          clientId: null,
          clientSecret: null,
          redirectUris: [],
          sdkGenerated: false,
        },
      }),
    );
  }

  private validateAdminAccount(dto: SaveAdminAccountDto): void {
    if (!dto.username || dto.username.length < 3) {
      throw new BadRequestException('Username must be at least 3 characters');
    }
    if (!dto.email || !dto.email.includes('@')) {
      throw new BadRequestException('Valid email address is required');
    }
    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    // Basic password strength validation
    const hasUppercase = /[A-Z]/.test(dto.password);
    const hasLowercase = /[a-z]/.test(dto.password);
    const hasDigit = /[0-9]/.test(dto.password);
    if (!hasUppercase || !hasLowercase || !hasDigit) {
      throw new BadRequestException(
        'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
      );
    }
  }

  private validateRealmSettings(dto: SaveRealmSettingsDto): void {
    if (!dto.name || dto.name.length < 2) {
      throw new BadRequestException('Realm name must be at least 2 characters');
    }
    if (!/^[a-z][a-z0-9-]*$/.test(dto.name)) {
      throw new BadRequestException(
        'Realm name must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens',
      );
    }
    if (dto.name === 'master' || dto.name === 'public') {
      throw new BadRequestException(`Realm name '${dto.name}' is reserved`);
    }
  }

  private validateSmtpConfig(dto: SaveSmtpConfigDto): void {
    if (!dto.host || dto.host.length === 0) {
      throw new BadRequestException('SMTP host is required');
    }
    if (!dto.port || dto.port < 1 || dto.port > 65535) {
      throw new BadRequestException('SMTP port must be between 1 and 65535');
    }
    if (!dto.from || !dto.from.includes('@')) {
      throw new BadRequestException('Valid from email address is required');
    }
  }

  private validateClientConfig(dto: SaveClientDto): void {
    if (!dto.clientId || dto.clientId.length < 3) {
      throw new BadRequestException('Client ID must be at least 3 characters');
    }
    if (!dto.redirectUris || dto.redirectUris.length === 0) {
      throw new BadRequestException('At least one redirect URI is required');
    }
    // Validate redirect URIs format
    for (const uri of dto.redirectUris) {
      try {
        const url = new URL(uri);
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new BadRequestException(
            `Redirect URI must use http or https protocol: ${uri}`,
          );
        }
      } catch {
        throw new BadRequestException(`Invalid redirect URI format: ${uri}`);
      }
    }
  }
}
