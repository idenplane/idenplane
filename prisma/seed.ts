import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { generateKeyPair, exportJWK } from 'jose';
import { randomUUID, randomBytes } from 'crypto';

// prisma is initialised inside main() so that the conditional dynamic import
// does not become a top-level await (which requires "module": "ESNext" and a
// supporting runtime flag).
let prisma: PrismaClient;

async function exportKeyToPem(
  key: CryptoKey,
  type: 'public' | 'private',
): Promise<string> {
  const exported = await crypto.subtle.exportKey(
    type === 'public' ? 'spki' : 'pkcs8',
    key,
  );
  const b64 = Buffer.from(exported).toString('base64');
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  const label = type === 'public' ? 'PUBLIC KEY' : 'PRIVATE KEY';
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

async function main() {
  // Initialise Prisma here so the dynamic import stays inside an async
  // function and never becomes a top-level await.
  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  if (databaseUrl.startsWith('file:')) {
    prisma = new PrismaClient();
  } else {
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const adapter = new PrismaPg({ connectionString: databaseUrl });
    prisma = new PrismaClient({ adapter });
  }

  console.log('Seeding database...');

  // Create test realm
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    extractable: true,
  });
  const publicKeyPem = await exportKeyToPem(publicKey, 'public');
  const privateKeyPem = await exportKeyToPem(privateKey, 'private');
  // Use a deterministic kid so re-seeding upserts the same row instead of
  // accumulating stale keys on every run.
  const kid = 'seed-default-signing-key';

  const realm = await prisma.realm.upsert({
    where: { name: 'test' },
    update: {
      displayName: 'Test Realm',
      enabled: true,
      accessTokenLifespan: 300,
      refreshTokenLifespan: 1800,
    },
    create: {
      name: 'test',
      displayName: 'Test Realm',
      enabled: true,
      accessTokenLifespan: 300,
      refreshTokenLifespan: 1800,
    },
  });

  // Upsert the signing key separately so that re-seeding replaces it with a
  // fresh key pair rather than silently leaving the old one in place.
  await prisma.realmSigningKey.upsert({
    where: { realmId_kid: { realmId: realm.id, kid } },
    update: {
      algorithm: 'RS256',
      publicKey: publicKeyPem,
      privateKey: privateKeyPem,
    },
    create: {
      realmId: realm.id,
      kid,
      algorithm: 'RS256',
      publicKey: publicKeyPem,
      privateKey: privateKeyPem,
    },
  });

  console.log(`  Realm: ${realm.name} (${realm.id})`);

  // Seed the canonical OIDC client-scope catalog for the realm so that
  // `GET /admin/realms/test/client-scopes` is populated (matches what
  // RealmsService.create does for realms created at runtime via the API).
  // The seed script is run with raw Prisma and can't easily import from the
  // Nest service tree, so the catalog is duplicated here — keep it in sync
  // with `src/scopes/scope-seed.service.ts`. Idempotent — skip-on-conflict.
  const SEEDED_SCOPES = [
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
          config: { 'user.attribute': 'username', 'claim.name': 'preferred_username' },
        },
        { name: 'full name', mapperType: 'oidc-full-name-mapper', config: {} },
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
          config: { 'user.attribute': 'emailVerified', 'claim.name': 'email_verified' },
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
    { name: 'web-origins', description: 'Web origins for CORS', mappers: [] },
    { name: 'offline_access', description: 'Offline access for long-lived tokens', mappers: [] },
  ];
  for (const scope of SEEDED_SCOPES) {
    const existing = await prisma.clientScope.findUnique({
      where: { realmId_name: { realmId: realm.id, name: scope.name } },
    });
    if (existing) continue;
    await prisma.clientScope.create({
      data: {
        realmId: realm.id,
        name: scope.name,
        description: scope.description,
        builtIn: true,
        protocolMappers: {
          create: scope.mappers.map((m) => ({
            name: m.name,
            mapperType: m.mapperType,
            config: m.config,
          })),
        },
      },
    });
  }
  console.log(`  Seeded ${SEEDED_SCOPES.length} client scopes`);

  // Create test user
  const passwordHash = await argon2.hash('password123', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const user = await prisma.user.upsert({
    where: { realmId_username: { realmId: realm.id, username: 'testuser' } },
    update: {},
    create: {
      realmId: realm.id,
      username: 'testuser',
      email: 'test@example.com',
      emailVerified: true,
      firstName: 'Test',
      lastName: 'User',
      enabled: true,
      passwordHash,
    },
  });

  console.log(`  User: ${user.username} (password: password123)`);

  // Create test client
  const rawSecret = randomBytes(32).toString('hex');
  const secretHash = await argon2.hash(rawSecret, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const client = await prisma.client.upsert({
    where: {
      realmId_clientId: { realmId: realm.id, clientId: 'test-client' },
    },
    update: {},
    create: {
      realmId: realm.id,
      clientId: 'test-client',
      clientSecret: secretHash,
      clientType: 'CONFIDENTIAL',
      name: 'Test Client',
      enabled: true,
      redirectUris: ['http://localhost:3000/callback'],
      webOrigins: ['http://localhost:3000'],
      grantTypes: [
        'authorization_code',
        'client_credentials',
        'refresh_token',
      ],
    },
  });

  console.log(`  Client: ${client.clientId}`);
  console.log(`  Client Secret: ${rawSecret}`);
  console.log('  (Save this secret — it won\'t be shown again!)');

  // Create test roles (realm-level, no clientId)
  let adminRole = await prisma.role.findFirst({
    where: { realmId: realm.id, clientId: null, name: 'admin' },
  });
  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: {
        realmId: realm.id,
        name: 'admin',
        description: 'Administrator role',
      },
    });
  }

  let userRole = await prisma.role.findFirst({
    where: { realmId: realm.id, clientId: null, name: 'user' },
  });
  if (!userRole) {
    userRole = await prisma.role.create({
      data: {
        realmId: realm.id,
        name: 'user',
        description: 'Regular user role',
      },
    });
  }

  // Assign roles to user
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, roleId: adminRole.id },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: userRole.id } },
    update: {},
    create: { userId: user.id, roleId: userRole.id },
  });

  console.log(`  Roles assigned: admin, user`);
  console.log('\nSeed completed!');
  console.log('\nQuick test (authorization_code flow):');
  console.log('  1. Direct the user to the authorization endpoint:');
  console.log(
    `     http://localhost:3000/realms/test/protocol/openid-connect/auth?response_type=code&client_id=test-client&redirect_uri=http://localhost:3000/callback&scope=openid`,
  );
  console.log('');
  console.log('  2. After login, exchange the returned code for tokens:');
  console.log(
    `  curl -X POST http://localhost:3000/realms/test/protocol/openid-connect/token \\`,
  );
  console.log(
    `    -H "Content-Type: application/x-www-form-urlencoded" \\`,
  );
  console.log(
    `    -d 'grant_type=authorization_code&client_id=test-client&client_secret=${rawSecret}&code=<CODE>&redirect_uri=http://localhost:3000/callback'`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
