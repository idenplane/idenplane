import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { join } from 'path';
import { createLoggerConfig } from './common/logging/logger.config.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { RealmsModule } from './realms/realms.module.js';
import { UsersModule } from './users/users.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { RolesModule } from './roles/roles.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OAuthModule } from './oauth/oauth.module.js';
import { TokensModule } from './tokens/tokens.module.js';
import { WellKnownModule } from './well-known/well-known.module.js';
import { ScopesModule } from './scopes/scopes.module.js';
import { LoginModule } from './login/login.module.js';
import { IdentityProvidersModule } from './identity-providers/identity-providers.module.js';
import { BrokerModule } from './broker/broker.module.js';
import { ConsentModule } from './consent/consent.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { EmailModule } from './email/email.module.js';
import { VerificationModule } from './verification/verification.module.js';
import { AccountModule } from './account/account.module.js';
import { PasswordPolicyModule } from './password-policy/password-policy.module.js';
import { BruteForceModule } from './brute-force/brute-force.module.js';
import { MfaModule } from './mfa/mfa.module.js';
import { AdminAuthModule } from './admin-auth/admin-auth.module.js';
import { ClientScopesModule } from './client-scopes/client-scopes.module.js';
import { DeviceModule } from './device/device.module.js';
import { HealthModule } from './health/health.module.js';
import { EventsModule } from './events/events.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { UserFederationModule } from './user-federation/user-federation.module.js';
import { SamlModule } from './saml/saml.module.js';
import { ThemeModule } from './theme/theme.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { ImpersonationModule } from './impersonation/impersonation.module.js';
import { StatsModule } from './stats/stats.module.js';
import { RedisModule } from './redis/redis.module.js';
import { CacheModule } from './cache/cache.module.js';
import { WebAuthnModule } from './webauthn/webauthn.module.js';
import { AuthorizationModule } from './authorization/authorization.module.js';
import { CustomAttributesModule } from './custom-attributes/custom-attributes.module.js';
import { PluginsModule } from './plugins/plugins.module.js';
import { AuthFlowModule } from './auth-flow/auth-flow.module.js';
import { VersioningModule } from './versioning/versioning.module.js';
import { StepUpModule } from './step-up/step-up.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { RiskAssessmentModule } from './risk-assessment/risk-assessment.module.js';
import { MigrationModule } from './migration/migration.module.js';
import { CorsModule } from './cors/cors.module.js';
import { ServiceAccountsModule } from './service-accounts/service-accounts.module.js';
import { AdminApiKeyGuard } from './common/guards/admin-api-key.guard.js';
import { AdminEventInterceptor } from './events/admin-event.interceptor.js';
import { MetricsInterceptor } from './metrics/metrics.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot(createLoggerConfig()),
    ThrottlerModule.forRoot([{
      ttl: parseInt(process.env['THROTTLE_TTL'] ?? '60000', 10),
      limit: parseInt(process.env['THROTTLE_LIMIT'] ?? '100', 10),
    }]),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, 'admin-ui'),
      serveRoot: '/console',
    }),
    RedisModule,
    CacheModule,
    PrismaModule,
    CryptoModule,
    EmailModule,
    VerificationModule,
    PasswordPolicyModule,
    BruteForceModule,
    MfaModule,
    AdminAuthModule,
    RealmsModule,
    UsersModule,
    ClientsModule,
    RolesModule,
    AuthModule,
    OAuthModule,
    TokensModule,
    WellKnownModule,
    ScopesModule,
    LoginModule,
    ConsentModule,
    GroupsModule,
    SessionsModule,
    IdentityProvidersModule,
    BrokerModule,
    AccountModule,
    ClientScopesModule,
    DeviceModule,
    HealthModule,
    EventsModule,
    MetricsModule,
    UserFederationModule,
    SamlModule,
    ThemeModule,
    WebhooksModule,
    RateLimitModule,
    ImpersonationModule,
    StatsModule,
    WebAuthnModule,
    AuthorizationModule,
    CustomAttributesModule,
    PluginsModule,
    AuthFlowModule,
    VersioningModule,
    StepUpModule,
    OrganizationsModule,
    RiskAssessmentModule,
    MigrationModule,
    CorsModule,
    ServiceAccountsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AdminApiKeyGuard },
    { provide: APP_INTERCEPTOR, useClass: AdminEventInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule {}
