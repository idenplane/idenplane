/**
 * Shared E2E test setup for Authme.
 *
 * REQUIREMENTS:
 * - A running PostgreSQL database is required.
 * - Uses TEST_DATABASE_URL env var if set, otherwise falls back to DATABASE_URL from .env.
 * - The database schema must be up-to-date (run `npx prisma migrate deploy` or `npx prisma db push`).
 *
 * Usage:
 *   const { app, cleanup, seedTestRealm } = await createTestApp();
 *   // ... run tests using `app` ...
 *   await cleanup();
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';
import { generateKeyPair } from 'jose';
import { randomUUID } from 'crypto';
import * as argon2 from 'argon2';

/** Admin API key used across all E2E tests. */
export const TEST_ADMIN_API_KEY = 'test-admin-key';

export interface SeededRealm {
  /** Convenience alias for realm.name — used by tests that access otherRealm.name directly. */
  name: string;
  realm: {
    id: string;
    name: string;
  };
  signingKey: {
    id: string;
    kid: string;
  };
  client: {
    id: string;
    clientId: string;
    clientSecret: string | null;
  };
  user: {
    id: string;
    username: string;
    email: string;
  };
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  cleanup: () => Promise<void>;
  seedTestRealm: (realmName?: string) => Promise<SeededRealm>;
}

/**
 * Creates and configures a NestJS application for E2E testing.
 * Mirrors the configuration in main.ts (ValidationPipe, cookieParser, exception filter).
 */
export async function createTestApp(): Promise<TestContext> {
  // Set admin API key for the test environment
  process.env['ADMIN_API_KEY'] = TEST_ADMIN_API_KEY;

  // Allow overriding the database URL for test environments
  if (process.env['TEST_DATABASE_URL']) {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL'];
  }

  const dbUrl = process.env['DATABASE_URL'];
  if (!dbUrl) {
    throw new Error(
      'E2E tests require a database.\n' +
        'Set DATABASE_URL in your .env file or export TEST_DATABASE_URL.\n' +
        'Quick start: docker compose -f docker-compose.dev.yml up -d postgres\n' +
        'Then run: npx prisma migrate deploy',
    );
  }

  let moduleFixture: TestingModule;
  try {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to compile test application — is the database running?\n` +
        `DATABASE_URL: ${dbUrl.replace(/\/\/.*@/, '//***@')}\n` +
        `Original error: ${message}\n\n` +
        `Quick start: docker compose -f docker-compose.dev.yml up -d postgres && npx prisma migrate deploy`,
    );
  }

  const app = moduleFixture.createNestApplication();

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  // Set up Swagger so /api-json is available (mirrors main.ts)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('AuthMe')
    .setDescription('Open-source Identity and Access Management Server')
    .setVersion('0.1.0')
    .addApiKey({ type: 'apiKey', name: 'x-admin-api-key', in: 'header' }, 'admin-api-key')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  await app.init();

  const prisma = app.get(PrismaService);

  const cleanup = async () => {
    await app.close();
  };

  /**
   * Seeds a test realm with a signing key, a confidential client, and a user.
   * Useful for tests that need a fully provisioned realm to operate against.
   */
  const seedTestRealm = async (
    realmName = 'test-realm',
  ): Promise<SeededRealm> => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', {
      extractable: true,
    });

    const exportKeyToPem = async (
      key: CryptoKey,
      type: 'public' | 'private',
    ): Promise<string> => {
      const exported = await crypto.subtle.exportKey(
        type === 'public' ? 'spki' : 'pkcs8',
        key,
      );
      const b64 = Buffer.from(exported).toString('base64');
      const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
      const label = type === 'public' ? 'PUBLIC KEY' : 'PRIVATE KEY';
      return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
    };

    const publicKeyPem = await exportKeyToPem(publicKey, 'public');
    const privateKeyPem = await exportKeyToPem(privateKey, 'private');
    const kid = randomUUID();

    // Hash secrets with argon2 before seeding
    const clientSecretHash = await argon2.hash('test-client-secret');
    const passwordHash = await argon2.hash('TestPassword123!');

    // Clean up any existing realm with the same name
    await prisma.realm
      .delete({ where: { name: realmName } })
      .catch(() => {});

    const realm = await prisma.realm.create({
      data: {
        name: realmName,
        displayName: 'Test Realm',
        enabled: true,
        signingKeys: {
          create: {
            kid,
            algorithm: 'RS256',
            publicKey: publicKeyPem,
            privateKey: privateKeyPem,
            active: true,
          },
        },
        clients: {
          create: {
            clientId: 'test-client',
            clientSecret: clientSecretHash,
            clientType: 'CONFIDENTIAL',
            name: 'Test Client',
            enabled: true,
            redirectUris: ['http://localhost:3000/callback'],
            webOrigins: ['http://localhost:3000'],
            grantTypes: ['authorization_code', 'client_credentials', 'password', 'refresh_token'],
          },
        },
      },
      include: {
        signingKeys: true,
        clients: true,
      },
    });

    const user = await prisma.user.create({
      data: {
        realmId: realm.id,
        username: 'testuser',
        email: 'testuser@example.com',
        emailVerified: true,
        firstName: 'Test',
        lastName: 'User',
        enabled: true,
        passwordHash,
      },
    });

    return {
      name: realm.name,
      realm: { id: realm.id, name: realm.name },
      signingKey: {
        id: realm.signingKeys[0].id,
        kid: realm.signingKeys[0].kid,
      },
      client: {
        id: realm.clients[0].id,
        clientId: realm.clients[0].clientId,
        clientSecret: realm.clients[0].clientSecret,
      },
      user: {
        id: user.id,
        username: user.username,
        email: user.email!,
      },
    };
  };

  return { app, prisma, cleanup, seedTestRealm };
}
