import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

// Exported so non-Nest contexts (prisma/seed.ts, migration scripts) can seed
// the same canonical OIDC scope catalog without rewriting it.
export const DEFAULT_SCOPES = [
  {
    name: 'openid',
    description: 'OpenID Connect scope',
    mappers: [
      {
        name: 'sub',
        mapperType: 'oidc-usermodel-attribute-mapper',
        config: { 'user.attribute': 'id', 'claim.name': 'sub' },
      },
    ],
  },
  {
    name: 'profile',
    description: 'User profile information',
    mappers: [
      {
        name: 'username',
        mapperType: 'oidc-usermodel-attribute-mapper',
        config: {
          'user.attribute': 'username',
          'claim.name': 'preferred_username',
        },
      },
      {
        name: 'full name',
        mapperType: 'oidc-full-name-mapper',
        config: {},
      },
      {
        name: 'given name',
        mapperType: 'oidc-usermodel-attribute-mapper',
        config: { 'user.attribute': 'firstName', 'claim.name': 'given_name' },
      },
      {
        name: 'family name',
        mapperType: 'oidc-usermodel-attribute-mapper',
        config: { 'user.attribute': 'lastName', 'claim.name': 'family_name' },
      },
    ],
  },
  {
    name: 'email',
    description: 'Email address',
    mappers: [
      {
        name: 'email',
        mapperType: 'oidc-usermodel-attribute-mapper',
        config: { 'user.attribute': 'email', 'claim.name': 'email' },
      },
      {
        name: 'email verified',
        mapperType: 'oidc-usermodel-attribute-mapper',
        config: {
          'user.attribute': 'emailVerified',
          'claim.name': 'email_verified',
        },
      },
    ],
  },
  {
    name: 'roles',
    description: 'User roles',
    mappers: [
      {
        name: 'realm roles',
        mapperType: 'oidc-role-list-mapper',
        config: { 'claim.name': 'realm_access' },
      },
    ],
  },
];

export const OPTIONAL_SCOPES = [
  {
    name: 'web-origins',
    description: 'Web origins for CORS',
    mappers: [],
  },
  {
    name: 'offline_access',
    description: 'Offline access for long-lived tokens',
    mappers: [],
  },
];

@Injectable()
export class ScopeSeedService {
  private readonly logger = new Logger(ScopeSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async seedDefaultScopes(realmId: string): Promise<void> {
    const allScopes = [...DEFAULT_SCOPES, ...OPTIONAL_SCOPES];

    for (const scopeDef of allScopes) {
      const existing = await this.prisma.clientScope.findUnique({
        where: { realmId_name: { realmId, name: scopeDef.name } },
      });

      if (existing) continue;

      await this.prisma.clientScope.create({
        data: {
          realmId,
          name: scopeDef.name,
          description: scopeDef.description,
          builtIn: true,
          protocolMappers: {
            create: scopeDef.mappers.map((m) => ({
              name: m.name,
              mapperType: m.mapperType,
              config: m.config,
            })),
          },
        },
      });
    }

    this.logger.log(`Seeded default scopes for realm ${realmId}`);
  }

  getDefaultScopeNames(): string[] {
    return DEFAULT_SCOPES.map((s) => s.name);
  }

  getOptionalScopeNames(): string[] {
    return OPTIONAL_SCOPES.map((s) => s.name);
  }
}
