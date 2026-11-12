import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Realm } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwkService } from '../crypto/jwk.service.js';
import { CacheService } from '../cache/cache.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ACR_VALUES_SUPPORTED } from '../step-up/step-up.service.js';
import {
  RateLimitGuard,
  RateLimitByIp,
} from '../rate-limit/rate-limit.guard.js';

@ApiTags('OIDC Discovery')
@Controller('realms/:realmName')
@SkipThrottle()
@UseGuards(RealmGuard, RateLimitGuard)
@RateLimitByIp()
@Public()
export class WellKnownController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwkService: JwkService,
    private readonly cache: CacheService,
  ) {}

  @Get('.well-known/openid-configuration')
  @ApiOperation({ summary: 'OpenID Connect discovery document' })
  @ApiResponse({
    status: 200,
    description: 'OpenID Connect discovery document',
  })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  discovery(@CurrentRealm() realm: Realm) {
    const baseUrl = process.env['BASE_URL'] ?? 'http://localhost:3000';
    const realmUrl = `${baseUrl}/realms/${realm.name}`;
    const protocolUrl = `${realmUrl}/protocol/openid-connect`;

    return {
      issuer: realmUrl,
      authorization_endpoint: `${protocolUrl}/auth`,
      token_endpoint: `${protocolUrl}/token`,
      userinfo_endpoint: `${protocolUrl}/userinfo`,
      jwks_uri: `${protocolUrl}/certs`,
      introspection_endpoint: `${protocolUrl}/token/introspect`,
      revocation_endpoint: `${protocolUrl}/revoke`,
      end_session_endpoint: `${protocolUrl}/logout`,
      response_types_supported: ['code'],
      device_authorization_endpoint: `${protocolUrl}/auth/device`,
      grant_types_supported: [
        'authorization_code',
        'client_credentials',
        'password',
        'refresh_token',
        'urn:ietf:params:oauth:grant-type:device_code',
      ],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: [
        'openid',
        'profile',
        'email',
        'roles',
        'offline_access',
      ],
      token_endpoint_auth_methods_supported: [
        'client_secret_post',
        'client_secret_basic',
        'none',
      ],
      claims_supported: [
        'sub',
        'iss',
        'aud',
        'exp',
        'iat',
        'auth_time',
        'nonce',
        'at_hash',
        'acr',
        'amr',
        'azp',
        'name',
        'email',
        'email_verified',
        'preferred_username',
        'given_name',
        'family_name',
        'realm_access',
        'resource_access',
      ],
      code_challenge_methods_supported: ['S256'],
      backchannel_logout_supported: true,
      backchannel_logout_session_supported: true,
      backchannel_logout_uri: `${protocolUrl}/logout/backchannel`,
      // Step-up authentication (OIDC Core §3.1.2.1 acr_values_supported)
      acr_values_supported: ACR_VALUES_SUPPORTED,
      // Step-up endpoints
      step_up_challenge_endpoint: `${realmUrl}/step-up/challenge`,
      step_up_verify_endpoint: `${realmUrl}/step-up/verify`,
      // WebAuthn / FIDO2 support
      webauthn_registration_endpoint: `${realmUrl}/webauthn/register/options`,
      webauthn_authentication_endpoint: `${realmUrl}/webauthn/authenticate/options`,
      ...(realm.webAuthnEnabled
        ? { passkey_endpoint: `${realmUrl}/webauthn` }
        : {}),
    };
  }

  @Get('protocol/openid-connect/certs')
  @ApiOperation({ summary: 'JSON Web Key Set (JWKS)' })
  @ApiResponse({ status: 200, description: 'JSON Web Key Set' })
  @ApiResponse({ status: 404, description: 'Realm not found' })
  async certs(@CurrentRealm() realm: Realm) {
    const cached = await this.cache.getCachedJWKS<{ keys: unknown[] }>(
      realm.id,
    );
    if (cached) return cached;

    const keys = await this.prisma.realmSigningKey.findMany({
      where: { realmId: realm.id, active: true },
    });

    const jwks = await Promise.all(
      keys.map((key) => this.jwkService.publicKeyToJwk(key.publicKey, key.kid)),
    );

    const result = { keys: jwks };
    await this.cache.cacheJWKS(realm.id, result);

    return result;
  }
}
