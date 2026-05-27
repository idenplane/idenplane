import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { escapeHtml } from '../common/utils/html-escape.util.js';
import { VerificationService } from '../verification/verification.service.js';
import { EmailService } from '../email/email.service.js';
import { PasswordPolicyService } from '../password-policy/password-policy.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { CaptchaService, CaptchaProvider } from './captcha.service.js';
import {
  RegisterDto,
  ApproveRegistrationDto,
  RejectRegistrationDto,
} from './dto/register.dto.js';
import {
  CreateRegistrationFieldDto,
  UpdateRegistrationFieldDto,
} from './dto/registration-field.dto.js';
import type { Realm } from '@prisma/client';

export interface PendingRegistration {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  enabled: boolean;
  createdAt: Date;
  attributes: Record<string, string>;
}

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly verificationService: VerificationService,
    private readonly emailService: EmailService,
    private readonly passwordPolicyService: PasswordPolicyService,
    private readonly webhooksService: WebhooksService,
    private readonly captchaService: CaptchaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Register a new user
   */
  async register(
    realm: Realm,
    dto: RegisterDto,
    captchaProvider?: CaptchaProvider,
  ): Promise<{
    userId: string;
    requiresApproval: boolean;
    emailSent: boolean;
  }> {
    // Validate CAPTCHA if enabled
    if (
      captchaProvider &&
      captchaProvider !== CaptchaProvider.NONE &&
      dto.captchaToken
    ) {
      const captchaResult = await this.captchaService.verify(
        dto.captchaToken,
        captchaProvider,
        'register',
      );
      if (!captchaResult.success) {
        throw new BadRequestException(
          `CAPTCHA verification failed: ${captchaResult.errorCodes?.join(', ') ?? 'invalid token'}`,
        );
      }
    }

    // Check if registration is allowed
    if (!realm.registrationAllowed) {
      throw new ForbiddenException(
        'Self-registration is disabled for this realm',
      );
    }

    // Validate email domain if restrictions are configured
    if (realm.allowedEmailDomains && realm.allowedEmailDomains.length > 0) {
      const emailDomain = dto.email.split('@')[1]?.toLowerCase();
      if (
        !emailDomain ||
        !realm.allowedEmailDomains
          .map((d) => d.toLowerCase())
          .includes(emailDomain)
      ) {
        throw new BadRequestException(
          `Email domain '${emailDomain}' is not allowed for self-registration`,
        );
      }
    }

    // Check if username already exists
    const existingUsername = await this.prisma.user.findUnique({
      where: {
        realmId_username: { realmId: realm.id, username: dto.username },
      },
    });
    if (existingUsername) {
      throw new ConflictException(
        `Username '${dto.username}' is already taken`,
      );
    }

    // Check if email already exists
    if (dto.email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { realmId_email: { realmId: realm.id, email: dto.email } },
      });
      if (existingEmail) {
        throw new ConflictException(`Email '${dto.email}' is already in use`);
      }
    }

    // Validate password against realm policy
    const validation = this.passwordPolicyService.validate(realm, dto.password);
    if (!validation.valid) {
      throw new BadRequestException(validation.errors.join('. '));
    }

    // Check password history
    const passwordHash = await this.crypto.hashPassword(dto.password);
    const requiresApproval = realm.registrationApprovalRequired;
    const userEnabled = !requiresApproval;

    const user = await this.prisma.user.create({
      data: {
        realmId: realm.id,
        username: dto.username,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        enabled: userEnabled,
        passwordHash,
        passwordChangedAt: new Date(),
        emailVerified: !realm.requireEmailVerification, // Skip verification if disabled in realm
      },
    });

    // Store custom attributes if provided (resolve attribute name → CustomAttribute.id)
    if (dto.attributes && Object.keys(dto.attributes).length > 0) {
      const attributeNames = Object.keys(dto.attributes);
      const customAttributes = await this.prisma.customAttribute.findMany({
        where: { realmId: realm.id, name: { in: attributeNames } },
        select: { id: true, name: true },
      });
      const attributeIdByName = new Map(
        customAttributes.map((a) => [a.name, a.id]),
      );
      const rows = Object.entries(dto.attributes)
        .map(([name, value]) => {
          const attributeId = attributeIdByName.get(name);
          if (!attributeId) return null;
          return { userId: user.id, attributeId, value };
        })
        .filter(
          (r): r is { userId: string; attributeId: string; value: string } =>
            r !== null,
        );
      if (rows.length > 0) {
        await this.prisma.userAttribute.createMany({ data: rows });
      }
    }

    // Record password history
    if (realm.passwordHistoryCount > 0) {
      await this.passwordPolicyService.recordHistory(
        user.id,
        realm.id,
        passwordHash,
        realm.passwordHistoryCount,
      );
    }

    let emailSent = false;

    // Send email verification if required
    if (realm.requireEmailVerification && user.email) {
      await this.sendVerificationEmail(realm, user.id, user.email);
      emailSent = true;
    }

    // If approval required, notify admins and dispatch webhook
    if (requiresApproval) {
      // Dispatch webhook for pending registration
      await this.webhooksService.dispatchEvent({
        realmId: realm.id,
        eventType: 'user.approval_pending',
        payload: {
          userId: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          createdAt: user.createdAt.toISOString(),
        },
      });

      this.logger.log(
        `Registration pending approval: ${user.username} (realm: ${realm.name})`,
      );
    } else {
      // Normal registration - dispatch webhook
      await this.webhooksService.dispatchEvent({
        realmId: realm.id,
        eventType: 'user.registered',
        payload: {
          userId: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          createdAt: user.createdAt.toISOString(),
        },
      });

      // Send welcome email if SMTP configured
      if (user.email) {
        this.sendWelcomeEmail(realm, user.email, user.username).catch(
          (err: unknown) => {
            this.logger.warn(
              `Failed to send welcome email: ${(err as Error).message}`,
            );
          },
        );
      }
    }

    return { userId: user.id, requiresApproval, emailSent };
  }

  /**
   * Send email verification to a user
   */
  async sendVerificationEmail(
    realm: Realm,
    userId: string,
    email: string,
  ): Promise<void> {
    const configured = await this.emailService.isConfigured(realm.name);
    if (!configured) {
      this.logger.warn(
        `SMTP not configured for realm "${realm.name}", skipping verification email`,
      );
      return;
    }

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

    const subject = `${realm.displayName || realm.name} - Verify your email`;
    // Escape interpolations into the HTML body (CodeQL js/xss). The realm
    // display name is operator-controlled and the URL is app-built, but both
    // are escaped defensively so no value can break out of the markup.
    const safeRealm = escapeHtml(realm.displayName || realm.name);
    const safeVerifyUrl = escapeHtml(verifyUrl);
    const html = `
      <h1>Welcome to ${safeRealm}!</h1>
      <p>Please verify your email address by clicking the link below:</p>
      <p><a href="${safeVerifyUrl}">Verify Email</a></p>
      <p>Or copy and paste this URL: ${safeVerifyUrl}</p>
      <p>This link will expire in 24 hours.</p>
    `;

    await this.emailService.sendEmail(realm.name, email, subject, html);
    this.logger.log(
      `Verification email sent to ${email} (realm: ${realm.name})`,
    );
  }

  /**
   * Send welcome email after successful registration
   */
  async sendWelcomeEmail(
    realm: Realm,
    email: string,
    username: string,
  ): Promise<void> {
    const configured = await this.emailService.isConfigured(realm.name);
    if (!configured) return;

    const subject = `Welcome to ${realm.displayName || realm.name}!`;
    // username is user-chosen and realm display name operator-set — escape both
    // before interpolating into the HTML body (CodeQL js/xss).
    const safeUsername = escapeHtml(username);
    const safeRealm = escapeHtml(realm.displayName || realm.name);
    const html = `
      <h1>Welcome, ${safeUsername}!</h1>
      <p>Your account has been successfully created in ${safeRealm}.</p>
      <p>You can now log in and start using the system.</p>
    `;

    await this.emailService.sendEmail(realm.name, email, subject, html);
  }

  /**
   * Verify email with token
   */
  async verifyEmail(
    realm: Realm,
    token: string,
  ): Promise<{ success: boolean; userId?: string }> {
    const result = await this.verificationService.validateToken(
      token,
      'email_verification',
    );
    if (!result) {
      return { success: false };
    }

    // Verify the user belongs to this realm
    const user = await this.prisma.user.findFirst({
      where: { id: result.userId, realmId: realm.id },
    });

    if (!user) {
      return { success: false };
    }

    // Update user email verification status
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    // If user was disabled pending approval, enable them
    if (!user.enabled && realm.registrationApprovalRequired) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { enabled: true },
      });

      // Dispatch webhook for approved user
      await this.webhooksService.dispatchEvent({
        realmId: realm.id,
        eventType: 'user.approved',
        payload: {
          userId: user.id,
          username: user.username,
          email: user.email,
          approvedAt: new Date().toISOString(),
        },
      });
    }

    return { success: true, userId: user.id };
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(
    realm: Realm,
    email: string,
  ): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findFirst({
      where: { realmId: realm.id, email },
    });

    if (!user) {
      // Don't reveal if user exists for security
      return { sent: false };
    }

    if (user.emailVerified) {
      return { sent: false };
    }

    await this.sendVerificationEmail(realm, user.id, email);
    return { sent: true };
  }

  /**
   * Get pending registrations for admin
   */
  async getPendingRegistrations(
    realm: Realm,
    skip = 0,
    take = 20,
  ): Promise<{ users: PendingRegistration[]; total: number }> {
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          realmId: realm.id,
          enabled: false, // Disabled users pending approval
          // Check they were created recently and have no sessions (to distinguish from disabled accounts)
        },
        select: {
          id: true,
          username: true,
          email: true,
          firstName: true,
          lastName: true,
          enabled: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.user.count({
        where: {
          realmId: realm.id,
          enabled: false,
        },
      }),
    ]);

    // Get custom attributes for each user
    const usersWithAttributes = await Promise.all(
      users.map(async (user) => {
        const attributes = await this.prisma.userAttribute.findMany({
          where: { userId: user.id },
          include: { attribute: { select: { name: true } } },
        });
        return {
          ...user,
          attributes: attributes.reduce(
            (acc, attr) => {
              acc[attr.attribute.name] = attr.value;
              return acc;
            },
            {} as Record<string, string>,
          ),
        };
      }),
    );

    return { users: usersWithAttributes, total };
  }

  /**
   * Approve a pending registration
   */
  async approveRegistration(
    realm: Realm,
    userId: string,
    dto: ApproveRegistrationDto,
  ): Promise<{ success: boolean; note?: string }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id, enabled: false },
    });

    if (!user) {
      throw new NotFoundException('Pending registration not found');
    }

    // Enable the user
    await this.prisma.user.update({
      where: { id: userId },
      data: { enabled: true },
    });

    // If email verification is required but not done, send verification email
    if (realm.requireEmailVerification && !user.emailVerified && user.email) {
      await this.sendVerificationEmail(realm, user.id, user.email);
    } else if (!realm.requireEmailVerification || user.emailVerified) {
      // Send welcome email if email is already verified or verification is disabled
      if (user.email) {
        await this.sendWelcomeEmail(realm, user.email, user.username);
      }
    }

    // Dispatch webhook
    await this.webhooksService.dispatchEvent({
      realmId: realm.id,
      eventType: 'user.approved',
      payload: {
        userId: user.id,
        username: user.username,
        email: user.email,
        approvedBy: 'admin',
        approvedAt: new Date().toISOString(),
        note: dto.note,
      },
    });

    this.logger.log(
      `Registration approved for ${user.username} (realm: ${realm.name})`,
    );

    return { success: true, note: dto.note };
  }

  /**
   * Reject a pending registration
   */
  async rejectRegistration(
    realm: Realm,
    userId: string,
    dto: RejectRegistrationDto,
  ): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, realmId: realm.id, enabled: false },
    });

    if (!user) {
      throw new NotFoundException('Pending registration not found');
    }

    // Delete the user
    await this.prisma.user.delete({
      where: { id: userId },
    });

    // Dispatch webhook
    await this.webhooksService.dispatchEvent({
      realmId: realm.id,
      eventType: 'user.rejected',
      payload: {
        userId,
        username: user.username,
        email: user.email,
        rejectedAt: new Date().toISOString(),
        reason: dto.reason,
      },
    });

    this.logger.log(
      `Registration rejected for ${user.username} (realm: ${realm.name})`,
    );

    return { success: true };
  }

  // ─── Registration Fields CRUD ──────────────────────────────────

  async createRegistrationField(realm: Realm, dto: CreateRegistrationFieldDto) {
    return this.prisma.registrationField.create({
      data: {
        realmId: realm.id,
        name: dto.name,
        displayName: dto.displayName,
        type: dto.type ?? 'text',
        required: dto.required ?? false,
        placeholder: dto.placeholder,
        helpText: dto.helpText,
        options: dto.options ?? [],
        validationPattern: dto.validationPattern,
        defaultValue: dto.defaultValue,
        sortOrder: dto.sortOrder ?? 0,
        enabled: dto.enabled ?? true,
      },
    });
  }

  async getRegistrationFields(realm: Realm) {
    return this.prisma.registrationField.findMany({
      where: { realmId: realm.id },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getEnabledRegistrationFields(realm: Realm) {
    return this.prisma.registrationField.findMany({
      where: { realmId: realm.id, enabled: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async updateRegistrationField(
    realm: Realm,
    fieldId: string,
    dto: UpdateRegistrationFieldDto,
  ) {
    const existing = await this.prisma.registrationField.findFirst({
      where: { id: fieldId, realmId: realm.id },
    });

    if (!existing) {
      throw new NotFoundException('Registration field not found');
    }

    return this.prisma.registrationField.update({
      where: { id: fieldId },
      data: {
        displayName: dto.displayName,
        type: dto.type,
        required: dto.required,
        placeholder: dto.placeholder,
        helpText: dto.helpText,
        options: dto.options,
        validationPattern: dto.validationPattern,
        defaultValue: dto.defaultValue,
        sortOrder: dto.sortOrder,
        enabled: dto.enabled,
      },
    });
  }

  async deleteRegistrationField(realm: Realm, fieldId: string): Promise<void> {
    const existing = await this.prisma.registrationField.findFirst({
      where: { id: fieldId, realmId: realm.id },
    });

    if (!existing) {
      throw new NotFoundException('Registration field not found');
    }

    await this.prisma.registrationField.delete({
      where: { id: fieldId },
    });
  }
}
