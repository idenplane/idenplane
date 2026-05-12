import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { ScopeSeedService } from '../scopes/scope-seed.service.js';
import type { WizardState } from '@prisma/client';

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

@Injectable()
export class SetupWizardService {
  private readonly logger = new Logger(SetupWizardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwkService: JwkService,
    private readonly scopeSeedService: ScopeSeedService,
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
      state = await this.prisma.wizardState.create({
        data: {
          completed: false,
          skipped: false,
          currentStep: 0,
        },
      });
    }

    return state;
  }

  /**
   * Save admin account credentials (Step 1)
   */
  async saveAdminAccount(dto: SaveAdminAccountDto): Promise<WizardState> {
    this.validateAdminAccount(dto);

    const passwordHash = await this.crypto.hashPassword(dto.password);

    return this.prisma.wizardState.update({
      where: { id: (await this.getWizardState()).id },
      data: {
        adminUsername: dto.username,
        adminEmail: dto.email,
        adminPasswordHash: passwordHash,
        currentStep: Math.max((await this.getWizardState()).currentStep, 1),
      },
    });
  }

  /**
   * Save realm settings (Step 2)
   */
  async saveRealmSettings(dto: SaveRealmSettingsDto): Promise<WizardState> {
    this.validateRealmSettings(dto);

    // Check if realm name already exists
    const existing = await this.prisma.realm.findUnique({
      where: { name: dto.name },
    });

    if (existing) {
      throw new BadRequestException(`Realm '${dto.name}' already exists`);
    }

    return this.prisma.wizardState.update({
      where: { id: (await this.getWizardState()).id },
      data: {
        realmName: dto.name,
        realmDisplayName: dto.displayName,
        currentStep: Math.max((await this.getWizardState()).currentStep, 2),
      },
    });
  }

  /**
   * Save SMTP configuration (Step 3)
   */
  async saveSmtpConfig(dto: SaveSmtpConfigDto): Promise<WizardState> {
    this.validateSmtpConfig(dto);

    return this.prisma.wizardState.update({
      where: { id: (await this.getWizardState()).id },
      data: {
        smtpConfig: {
          host: dto.host,
          port: dto.port,
          user: dto.user,
          password: dto.password,
          from: dto.from,
          secure: dto.secure,
        },
        currentStep: Math.max((await this.getWizardState()).currentStep, 3),
      },
    });
  }

  /**
   * Save client application (Step 4)
   */
  async saveClient(dto: SaveClientDto): Promise<WizardState> {
    this.validateClientConfig(dto);

    const state = await this.getWizardState();

    // Validate realm exists
    if (!state.realmName) {
      throw new BadRequestException(
        'Realm must be created before adding a client',
      );
    }

    const realm = await this.prisma.realm.findUnique({
      where: { name: state.realmName },
    });

    if (!realm) {
      throw new BadRequestException(
        'Realm not found. Please complete Step 2 first.',
      );
    }

    // Check if client already exists
    const existingClient = await this.prisma.client.findUnique({
      where: {
        realmId_clientId: { realmId: realm.id, clientId: dto.clientId },
      },
    });

    if (existingClient) {
      throw new BadRequestException(
        `Client '${dto.clientId}' already exists in realm '${realm.name}'`,
      );
    }

    // Generate client secret
    const clientSecret = this.crypto.generateSecret();

    // Create the client
    await this.prisma.client.create({
      data: {
        realmId: realm.id,
        clientId: dto.clientId,
        clientSecret,
        clientType: 'CONFIDENTIAL',
        name: dto.clientId,
        enabled: true,
        redirectUris: dto.redirectUris,
        grantTypes: ['authorization_code'],
      },
    });

    return this.prisma.wizardState.update({
      where: { id: state.id },
      data: {
        clientId: dto.clientId,
        clientSecret,
        redirectUris: dto.redirectUris,
        currentStep: Math.max(state.currentStep, 4),
      },
    });
  }

  /**
   * Mark SDK step as completed (Step 5)
   */
  async markSdkGenerated(): Promise<WizardState> {
    return this.prisma.wizardState.update({
      where: { id: (await this.getWizardState()).id },
      data: {
        sdkGenerated: true,
        currentStep: Math.max((await this.getWizardState()).currentStep, 5),
      },
    });
  }

  /**
   * Complete the wizard and finalize the setup
   */
  async completeWizard(): Promise<{ success: boolean; message: string }> {
    const state = await this.getWizardState();

    // Validate all required steps are completed
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

    // Create master realm with signing key
    const keyPair = await this.jwkService.generateRsaKeyPair();

    // Build SMTP data if config exists
    const smtpData = state.smtpConfig
      ? {
          smtpHost: (state.smtpConfig as Record<string, unknown>)
            .host as string,
          smtpPort: (state.smtpConfig as Record<string, unknown>)
            .port as number,
          smtpUser: (state.smtpConfig as Record<string, unknown>)
            .user as string,
          smtpPassword: (state.smtpConfig as Record<string, unknown>)
            .password as string,
          smtpFrom: (state.smtpConfig as Record<string, unknown>)
            .from as string,
          smtpSecure: (state.smtpConfig as Record<string, unknown>)
            .secure as boolean,
        }
      : {};

    // Create realm
    const realm = await this.prisma.realm.create({
      data: {
        name: state.realmName,
        displayName: state.realmDisplayName || state.realmName,
        enabled: true,
        ...smtpData,
        signingKeys: {
          create: {
            kid: keyPair.kid,
            algorithm: 'RS256',
            publicKey: keyPair.publicKeyPem,
            privateKey: keyPair.privateKeyPem,
          },
        },
      },
    });

    // Create admin roles
    const superAdmin = await this.prisma.role.create({
      data: {
        realmId: realm.id,
        name: 'super-admin',
        description: 'Full access to all realms and settings',
      },
    });

    await this.prisma.role.create({
      data: {
        realmId: realm.id,
        name: 'realm-admin',
        description: 'Manage specific realms',
      },
    });

    await this.prisma.role.create({
      data: {
        realmId: realm.id,
        name: 'view-only',
        description: 'Read-only access',
      },
    });

    // Create admin user
    const adminUser = await this.prisma.user.create({
      data: {
        realmId: realm.id,
        username: state.adminUsername,
        email: state.adminEmail,
        enabled: true,
        passwordHash: state.adminPasswordHash,
        passwordChangedAt: new Date(),
      },
    });

    // Assign super-admin role
    await this.prisma.userRole.create({
      data: { userId: adminUser.id, roleId: superAdmin.id },
    });

    // Seed default scopes
    await this.scopeSeedService.seedDefaultScopes(realm.id);

    // Mark wizard as completed
    await this.prisma.wizardState.update({
      where: { id: state.id },
      data: {
        completed: true,
        currentStep: WIZARD_STEPS.length,
      },
    });

    this.logger.log(
      `Wizard completed. Realm '${realm.name}' created with admin user '${state.adminUsername}'`,
    );

    return {
      success: true,
      message: `Setup completed successfully. Realm '${realm.name}' created with admin user '${state.adminUsername}'`,
    };
  }

  /**
   * Skip the wizard (for advanced users)
   */
  async skipWizard(): Promise<WizardState> {
    return this.prisma.wizardState.update({
      where: { id: (await this.getWizardState()).id },
      data: {
        skipped: true,
      },
    });
  }

  /**
   * Reset wizard state (for development/testing)
   */
  async resetWizard(): Promise<void> {
    await this.prisma.wizardState.deleteMany({});
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
