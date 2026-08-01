import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { ScopeSeedService } from '../scopes/scope-seed.service.js';
import { ThemeService } from '../theme/theme.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CreateRealmDto } from './dto/create-realm.dto.js';
import { UpdateRealmDto } from './dto/update-realm.dto.js';
import { encryptEmailProviderConfig } from './realm-secrets.util.js';

@Injectable()
export class RealmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwkService: JwkService,
    private readonly scopeSeedService: ScopeSeedService,
    private readonly themeService: ThemeService,
    private readonly cache: CacheService,
    private readonly crypto: CryptoService,
  ) {}

  private redactSmtpPassword(realm: Record<string, unknown> | null) {
    if (realm && realm['smtpPassword']) {
      return { ...realm, smtpPassword: '••••••' };
    }
    return realm;
  }

  async create(dto: CreateRealmDto) {
    const existing = await this.prisma.realm.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`Realm '${dto.name}' already exists`);
    }

    const keyPair = await this.jwkService.generateRsaKeyPair();

    const realm = await this.prisma.realm.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        enabled: dto.enabled,
        accessTokenLifespan: dto.accessTokenLifespan,
        refreshTokenLifespan: dto.refreshTokenLifespan,
        smtpHost: dto.smtpHost,
        smtpPort: dto.smtpPort,
        smtpUser: dto.smtpUser,
        smtpPassword: this.crypto.encryptSecret(dto.smtpPassword),
        smtpFrom: dto.smtpFrom,
        smtpSecure: dto.smtpSecure,
        emailProvider: dto.emailProvider,
        // Cast to Prisma's own JSON input type, not to a bare `object`.
        // A DTO class has no index signature, so it is not assignable to
        // InputJsonObject and the build fails without a cast. The previous
        // `as object | undefined` compiled, but @typescript-eslint's
        // no-unnecessary-type-assertion judged it a no-op widening and
        // `npm run lint --fix` deleted it — breaking the build on a command
        // that is supposed to only check formatting. Naming the real target
        // type states the intent and is not flagged.
        emailProviderConfig: encryptEmailProviderConfig(
          this.crypto,
          dto.emailProviderConfig,
        ) as Prisma.InputJsonValue | undefined,
        passwordMinLength: dto.passwordMinLength,
        passwordRequireUppercase: dto.passwordRequireUppercase,
        passwordRequireLowercase: dto.passwordRequireLowercase,
        passwordRequireDigits: dto.passwordRequireDigits,
        passwordRequireSpecialChars: dto.passwordRequireSpecialChars,
        passwordHistoryCount: dto.passwordHistoryCount,
        passwordMaxAgeDays: dto.passwordMaxAgeDays,
        bruteForceEnabled: dto.bruteForceEnabled,
        maxLoginFailures: dto.maxLoginFailures,
        lockoutDuration: dto.lockoutDuration,
        failureResetTime: dto.failureResetTime,
        permanentLockoutAfter: dto.permanentLockoutAfter,
        registrationAllowed: dto.registrationAllowed,
        requireEmailVerification: dto.requireEmailVerification,
        mfaRequired: dto.mfaRequired,
        offlineTokenLifespan: dto.offlineTokenLifespan,
        eventsEnabled: dto.eventsEnabled,
        eventsExpiration: dto.eventsExpiration,
        adminEventsEnabled: dto.adminEventsEnabled,
        // Rate limiting
        rateLimitEnabled: dto.rateLimitEnabled,
        clientRateLimitPerMinute: dto.clientRateLimitPerMinute,
        clientRateLimitPerHour: dto.clientRateLimitPerHour,
        userRateLimitPerMinute: dto.userRateLimitPerMinute,
        userRateLimitPerHour: dto.userRateLimitPerHour,
        ipRateLimitPerMinute: dto.ipRateLimitPerMinute,
        ipRateLimitPerHour: dto.ipRateLimitPerHour,
        // Session management
        maxSessionsPerUser: dto.maxSessionsPerUser,
        // Theming
        themeName: dto.themeName,
        theme:
          dto.theme !== undefined
            ? (dto.theme as unknown as Prisma.InputJsonValue)
            : undefined,
        loginTheme: dto.loginTheme,
        accountTheme: dto.accountTheme,
        emailTheme: dto.emailTheme,
        // Impersonation
        impersonationEnabled: dto.impersonationEnabled,
        impersonationMaxDuration: dto.impersonationMaxDuration,
        // WebAuthn / passkeys
        webAuthnEnabled: dto.webAuthnEnabled,
        webAuthnRpName: dto.webAuthnRpName,
        webAuthnRpId: dto.webAuthnRpId,
        // Adaptive authentication
        adaptiveAuthEnabled: dto.adaptiveAuthEnabled,
        riskThresholdStepUp: dto.riskThresholdStepUp,
        riskThresholdBlock: dto.riskThresholdBlock,
        // Magic link / passwordless authentication
        magicLinkEnabled: dto.magicLinkEnabled,
        magicLinkExpirySeconds: dto.magicLinkExpirySeconds,
        magicLinkRateLimitPerEmail: dto.magicLinkRateLimitPerEmail,
        magicLinkRateLimitWindowSeconds: dto.magicLinkRateLimitWindowSeconds,
        magicLinkEmailSubject: dto.magicLinkEmailSubject,
        magicLinkEmailTemplate: dto.magicLinkEmailTemplate,
        // Localisation
        defaultLocale: dto.defaultLocale,
        supportedLocales: dto.supportedLocales,
        // Legal / registration controls
        termsOfServiceUrl: dto.termsOfServiceUrl,
        registrationApprovalRequired: dto.registrationApprovalRequired,
        allowedEmailDomains: dto.allowedEmailDomains,
        privacyPolicyUrl: dto.privacyPolicyUrl,
        // CAPTCHA configuration
        captchaEnabled: dto.captchaEnabled,
        captchaProvider: dto.captchaProvider,
        recaptchaSiteKey: dto.recaptchaSiteKey,
        recaptchaSecretKey: this.crypto.encryptSecret(dto.recaptchaSecretKey),
        hcaptchaSiteKey: dto.hcaptchaSiteKey,
        hcaptchaSecretKey: this.crypto.encryptSecret(dto.hcaptchaSecretKey),
        captchaScoreThreshold: dto.captchaScoreThreshold,
        // SCIM provisioning
        scimEnabled: dto.scimEnabled,
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

    // Seed default scopes for the new realm
    await this.scopeSeedService.seedDefaultScopes(realm.id);

    return this.redactSmtpPassword(realm) as Realm;
  }

  async findAll() {
    const realms = await this.prisma.realm.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return realms.map((r) => this.redactSmtpPassword(r));
  }

  async findByName(name: string): Promise<Realm> {
    const cached = await this.cache.getCachedRealmByName<Realm | null>(name);
    if (cached) {
      return this.redactSmtpPassword(cached) as Realm;
    }

    const realm = await this.prisma.realm.findUnique({
      where: { name },
    });
    if (!realm) {
      throw new NotFoundException(`Realm '${name}' not found`);
    }

    await Promise.all([
      this.cache.cacheRealmByName(name, realm),
      this.cache.cacheRealmConfig(realm.id, realm),
    ]);

    return this.redactSmtpPassword(realm) as Realm;
  }

  async findByNameRaw(name: string): Promise<Realm> {
    const cached = await this.cache.getCachedRealmByName<Realm | null>(name);
    if (cached) return cached;

    const realm = await this.prisma.realm.findUnique({
      where: { name },
    });
    if (!realm) {
      throw new NotFoundException(`Realm '${name}' not found`);
    }

    await Promise.all([
      this.cache.cacheRealmByName(name, realm),
      this.cache.cacheRealmConfig(realm.id, realm),
    ]);

    return realm;
  }

  async update(name: string, dto: UpdateRealmDto) {
    const existing = await this.findByNameRaw(name);

    // Validate theme names against available themes
    const themeFields = [
      dto.loginTheme,
      dto.accountTheme,
      dto.emailTheme,
      dto.themeName,
    ].filter(Boolean);
    if (themeFields.length > 0) {
      const availableNames = this.themeService
        .getAvailableThemes()
        .map((t) => t.name);
      for (const themeName of themeFields) {
        if (!availableNames.includes(themeName!)) {
          throw new BadRequestException(
            `Theme '${themeName}' does not exist. Available themes: ${availableNames.join(', ')}`,
          );
        }
      }
    }

    const data: Record<string, unknown> = {
      displayName: dto.displayName,
      enabled: dto.enabled,
      accessTokenLifespan: dto.accessTokenLifespan,
      refreshTokenLifespan: dto.refreshTokenLifespan,
      smtpHost: dto.smtpHost,
      smtpPort: dto.smtpPort,
      smtpUser: dto.smtpUser,
      smtpFrom: dto.smtpFrom,
      smtpSecure: dto.smtpSecure,
      emailProvider: dto.emailProvider,
      emailProviderConfig: encryptEmailProviderConfig(
        this.crypto,
        dto.emailProviderConfig,
      ),
      passwordMinLength: dto.passwordMinLength,
      passwordRequireUppercase: dto.passwordRequireUppercase,
      passwordRequireLowercase: dto.passwordRequireLowercase,
      passwordRequireDigits: dto.passwordRequireDigits,
      passwordRequireSpecialChars: dto.passwordRequireSpecialChars,
      passwordHistoryCount: dto.passwordHistoryCount,
      passwordMaxAgeDays: dto.passwordMaxAgeDays,
      bruteForceEnabled: dto.bruteForceEnabled,
      maxLoginFailures: dto.maxLoginFailures,
      lockoutDuration: dto.lockoutDuration,
      failureResetTime: dto.failureResetTime,
      permanentLockoutAfter: dto.permanentLockoutAfter,
      registrationAllowed: dto.registrationAllowed,
      requireEmailVerification: dto.requireEmailVerification,
      mfaRequired: dto.mfaRequired,
      offlineTokenLifespan: dto.offlineTokenLifespan,
      eventsEnabled: dto.eventsEnabled,
      eventsExpiration: dto.eventsExpiration,
      adminEventsEnabled: dto.adminEventsEnabled,
      // Rate limiting fields
      rateLimitEnabled: dto.rateLimitEnabled,
      clientRateLimitPerMinute: dto.clientRateLimitPerMinute,
      clientRateLimitPerHour: dto.clientRateLimitPerHour,
      userRateLimitPerMinute: dto.userRateLimitPerMinute,
      userRateLimitPerHour: dto.userRateLimitPerHour,
      ipRateLimitPerMinute: dto.ipRateLimitPerMinute,
      ipRateLimitPerHour: dto.ipRateLimitPerHour,
      // Session management
      maxSessionsPerUser: dto.maxSessionsPerUser,
      // Theming
      themeName: dto.themeName,
      theme: dto.theme,
      loginTheme: dto.loginTheme,
      accountTheme: dto.accountTheme,
      emailTheme: dto.emailTheme,
      // Impersonation
      impersonationEnabled: dto.impersonationEnabled,
      impersonationMaxDuration: dto.impersonationMaxDuration,
      // WebAuthn / passkeys
      webAuthnEnabled: dto.webAuthnEnabled,
      webAuthnRpName: dto.webAuthnRpName,
      webAuthnRpId: dto.webAuthnRpId,
      // Adaptive authentication
      adaptiveAuthEnabled: dto.adaptiveAuthEnabled,
      riskThresholdStepUp: dto.riskThresholdStepUp,
      riskThresholdBlock: dto.riskThresholdBlock,
      // Magic link / passwordless authentication
      magicLinkEnabled: dto.magicLinkEnabled,
      magicLinkExpirySeconds: dto.magicLinkExpirySeconds,
      magicLinkRateLimitPerEmail: dto.magicLinkRateLimitPerEmail,
      magicLinkRateLimitWindowSeconds: dto.magicLinkRateLimitWindowSeconds,
      magicLinkEmailSubject: dto.magicLinkEmailSubject,
      magicLinkEmailTemplate: dto.magicLinkEmailTemplate,
      // Localisation
      defaultLocale: dto.defaultLocale,
      supportedLocales: dto.supportedLocales,
      // Legal / registration controls
      termsOfServiceUrl: dto.termsOfServiceUrl,
      registrationApprovalRequired: dto.registrationApprovalRequired,
      allowedEmailDomains: dto.allowedEmailDomains,
      privacyPolicyUrl: dto.privacyPolicyUrl,
      // CAPTCHA configuration
      captchaEnabled: dto.captchaEnabled,
      captchaProvider: dto.captchaProvider,
      recaptchaSiteKey: dto.recaptchaSiteKey,
      recaptchaSecretKey: this.crypto.encryptSecret(dto.recaptchaSecretKey),
      hcaptchaSiteKey: dto.hcaptchaSiteKey,
      hcaptchaSecretKey: this.crypto.encryptSecret(dto.hcaptchaSecretKey),
      captchaScoreThreshold: dto.captchaScoreThreshold,
      // SCIM provisioning
      scimEnabled: dto.scimEnabled,
      scimUserAutocreate: dto.scimUserAutocreate,
      scimGroupSyncEnabled: dto.scimGroupSyncEnabled,
      // Event retention
      loginEventRetentionDays: dto.loginEventRetentionDays,
      adminEventRetentionDays: dto.adminEventRetentionDays,
      // User lifecycle
      deletionGracePeriodDays: dto.deletionGracePeriodDays,
    };

    // Only update password if a real value is provided (not the redacted placeholder)
    if (dto.smtpPassword && dto.smtpPassword !== '••••••') {
      data.smtpPassword = this.crypto.encryptSecret(dto.smtpPassword);
    }

    const realm = await this.prisma.realm.update({
      where: { name },
      data,
    });

    await this.cache.invalidateRealmCache(existing.id, name);

    return this.redactSmtpPassword(realm);
  }

  async remove(name: string) {
    const existing = await this.findByNameRaw(name);
    await this.cache.invalidateRealmCache(existing.id, name);
    return this.prisma.realm.delete({ where: { name } });
  }
}
