import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { VerificationService } from '../verification/verification.service.js';
import { EmailService } from '../email/email.service.js';
import { PasswordPolicyService } from '../password-policy/password-policy.service.js';
import { ThemeEmailService } from '../theme/theme-email.service.js';
import { BruteForceService } from '../brute-force/brute-force.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import type { Realm } from '@prisma/client';

const USER_SELECT = {
  id: true,
  realmId: true,
  username: true,
  email: true,
  emailVerified: true,
  firstName: true,
  lastName: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly verificationService: VerificationService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
    private readonly passwordPolicyService: PasswordPolicyService,
    private readonly themeEmail: ThemeEmailService,
    private readonly bruteForceService: BruteForceService,
  ) {}

  async create(realm: Realm, dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: {
        realmId_username: { realmId: realm.id, username: dto.username },
      },
    });
    if (existing) {
      throw new ConflictException(
        `User '${dto.username}' already exists in realm '${realm.name}'`,
      );
    }

    if (dto.email) {
      const emailTaken = await this.prisma.user.findUnique({
        where: { realmId_email: { realmId: realm.id, email: dto.email } },
      });
      if (emailTaken) {
        throw new ConflictException(`Email '${dto.email}' is already in use`);
      }
    }

    let passwordHash: string | undefined;
    if (dto.password) {
      // Validate password against realm policy
      const validation = this.passwordPolicyService.validate(
        realm,
        dto.password,
      );
      if (!validation.valid) {
        throw new BadRequestException(validation.errors.join('. '));
      }

      passwordHash = await this.crypto.hashPassword(dto.password);
    }

    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          realmId: realm.id,
          username: dto.username,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          enabled: dto.enabled,
          passwordHash,
          passwordChangedAt: passwordHash ? new Date() : undefined,
        },
        select: USER_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = (error.meta?.target as string[]) ?? [];
        if (target.includes('email')) {
          throw new ConflictException(`Email '${dto.email}' is already in use`);
        }
        throw new ConflictException(
          `User '${dto.username}' already exists in realm '${realm.name}'`,
        );
      }
      throw error;
    }

    // Record password history
    if (passwordHash && realm.passwordHistoryCount > 0) {
      await this.passwordPolicyService.recordHistory(
        user.id,
        realm.id,
        passwordHash,
        realm.passwordHistoryCount,
      );
    }

    // Send verification email if user has email and SMTP is configured
    if (user.email) {
      this.sendVerificationEmail(realm, user.id, user.email).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to send verification email: ${message}`);
      });
    }

    return user;
  }

  async sendVerificationEmail(realm: Realm, userId: string, email: string) {
    const configured = await this.emailService.isConfigured(realm.name);
    if (!configured) return;

    const rawToken = await this.verificationService.createToken(
      userId,
      'email_verification',
      86400,
    );
    const baseUrl = this.config.get<string>(
      'BASE_URL',
      'http://localhost:3000',
    );
    const verifyUrl = `${baseUrl}/realms/${realm.name}/verify-email?token=${rawToken}`;

    const subject = this.themeEmail.getSubject(realm, 'verifyEmailSubject');
    const html = this.themeEmail.renderEmail(realm, 'verify-email', {
      verifyUrl,
    });
    await this.emailService.sendEmail(realm.name, email, subject, html);
  }

  async findAll(
    realm: Realm,
    skip: number,
    take: number,
    filters?: {
      search?: string;
      username?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
    },
  ) {
    const { search, username, email, firstName, lastName } = filters ?? {};

    // Build field-level filter conditions. Each provided param narrows the
    // result set with a case-insensitive contains match.
    const fieldFilters: Prisma.UserWhereInput[] = [];
    if (username)
      fieldFilters.push({
        username: { contains: username, mode: 'insensitive' },
      });
    if (email)
      fieldFilters.push({ email: { contains: email, mode: 'insensitive' } });
    if (firstName)
      fieldFilters.push({
        firstName: { contains: firstName, mode: 'insensitive' },
      });
    if (lastName)
      fieldFilters.push({
        lastName: { contains: lastName, mode: 'insensitive' },
      });

    // `search` performs an OR across all text fields so a caller can supply a
    // single term and match any of them.
    const searchFilter: Prisma.UserWhereInput | undefined = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined;

    const where: Prisma.UserWhereInput = {
      realmId: realm.id,
      ...(fieldFilters.length > 0 ? { AND: fieldFilters } : {}),
      ...(searchFilter ?? {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        skip,
        take,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users, total };
  }

  async findById(realm: Realm, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id },
      select: USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException(`User not found`);
    }
    return user;
  }

  async update(realm: Realm, userId: string, dto: UpdateUserDto) {
    const user = await this.findById(realm, userId);

    if (dto.email && dto.email !== user.email) {
      const emailTaken = await this.prisma.user.findUnique({
        where: { realmId_email: { realmId: realm.id, email: dto.email } },
      });
      if (emailTaken) {
        throw new ConflictException(`Email '${dto.email}' is already in use`);
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        enabled: dto.enabled,
        emailVerified: dto.emailVerified,
      },
      select: USER_SELECT,
    });
  }

  async remove(realm: Realm, userId: string) {
    await this.findById(realm, userId);
    await this.prisma.user.delete({ where: { id: userId } });
  }

  async setPassword(realm: Realm, userId: string, password: string) {
    await this.findById(realm, userId);

    // Validate against realm password policy
    const validation = this.passwordPolicyService.validate(realm, password);
    if (!validation.valid) {
      throw new BadRequestException(validation.errors.join('. '));
    }

    // Check password history
    if (realm.passwordHistoryCount > 0) {
      const inHistory = await this.passwordPolicyService.checkHistory(
        userId,
        realm.id,
        password,
        realm.passwordHistoryCount,
      );
      if (inHistory) {
        throw new BadRequestException(
          'Password was used recently. Choose a different password.',
        );
      }
    }

    const passwordHash = await this.crypto.hashPassword(password);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });

    // Unlock brute-force locked account and clear failure records
    await this.bruteForceService.resetFailures(realm.id, userId);

    // Record password history
    await this.passwordPolicyService.recordHistory(
      userId,
      realm.id,
      passwordHash,
      realm.passwordHistoryCount,
    );
  }

  async getOfflineSessions(realm: Realm, userId: string) {
    await this.findById(realm, userId);
    const tokens = await this.prisma.refreshToken.findMany({
      where: { session: { userId }, isOffline: true, revoked: false },
      include: {
        session: { select: { id: true, userId: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return tokens
      .filter((t) => t.session !== null)
      .map((t) => ({
        id: t.id,
        sessionId: t.session.id,
        sessionStarted: t.session.createdAt,
        expiresAt: t.expiresAt,
        createdAt: t.createdAt,
      }));
  }

  async revokeOfflineSession(realm: Realm, userId: string, tokenId: string) {
    await this.findById(realm, userId);
    const token = await this.prisma.refreshToken.findFirst({
      where: { id: tokenId, session: { userId }, isOffline: true },
    });
    if (!token) {
      throw new NotFoundException('Offline session not found');
    }
    await this.prisma.refreshToken.update({
      where: { id: tokenId },
      data: { revoked: true },
    });
  }

  /**
   * Get all consents for a user in the realm.
   */
  async getUserConsents(realm: Realm, userId: string) {
    await this.findById(realm, userId);
    const consents = await this.prisma.userConsent.findMany({
      where: { userId },
      include: {
        client: {
          select: {
            id: true,
            clientId: true,
            name: true,
            description: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return consents.map((consent) => ({
      id: consent.id,
      clientId: consent.clientId,
      clientName: consent.client?.name ?? consent.client?.clientId ?? 'Unknown',
      scopes: consent.scopes,
      createdAt: consent.createdAt,
      updatedAt: consent.updatedAt,
    }));
  }

  /**
   * Get consent history for a user.
   */
  async getUserConsentHistory(
    realm: Realm,
    userId: string,
    options?: { page?: number; limit?: number },
  ) {
    await this.findById(realm, userId);

    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
    const page = Math.max(options?.page ?? 1, 1);
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.prisma.userConsentHistory.findMany({
        where: { userId },
        include: {
          client: { select: { id: true, clientId: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.userConsentHistory.count({ where: { userId } }),
    ]);

    const history = rows.map((entry) => ({
      id: entry.id,
      clientId: entry.clientId,
      clientName: entry.client?.name ?? entry.client?.clientId ?? 'Unknown',
      action: entry.action,
      scopes: entry.scopes,
      policyVersion: entry.policyVersion,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      metadata: entry.metadata,
      createdAt: entry.createdAt,
    }));

    return { history, total, page, pageSize: limit };
  }
}
