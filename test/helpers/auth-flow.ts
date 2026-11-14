import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { MfaService } from '../../src/mfa/mfa.service';
import type { SoftAuthenticator } from './soft-authenticator';

/** Shared fixtures for the custom auth-flow runtime suites. */

export const FLOW_ENV = 'AUTH_FLOW_RUNTIME_ENABLED';
export const TXN_COOKIE = 'IDENPLANE_AUTHN_TXN';
export const REDIRECT_URI = 'http://localhost:3000/callback';
export const PASSWORD = 'TestPassword123!';

export const ACR = {
  password: 'urn:idenplane:acr:password',
  mfa: 'urn:idenplane:acr:mfa',
  webauthn: 'urn:idenplane:acr:webauthn',
} as const;

export type Steps = Array<Record<string, unknown>>;

export const PASSWORD_ONLY: Steps = [
  { id: 'pw', type: 'password', required: true, order: 1 },
];
export const PASSWORD_TOTP: Steps = [
  { id: 'pw', type: 'password', required: true, order: 1 },
  { id: 'otp', type: 'totp', required: true, order: 2 },
];
export const PASSKEY_OR_PASSWORD: Steps = [
  {
    id: 'pk',
    type: 'webauthn',
    required: true,
    order: 1,
    fallbackStepId: 'pw',
  },
  { id: 'pw', type: 'password', required: true, order: 2 },
];

/** Sets AUTH_FLOW_RUNTIME_ENABLED for a block and restores it afterwards. */
export function withRuntimeEnv(value: string | undefined): () => void {
  const previous = process.env[FLOW_ENV];
  if (value === undefined) delete process.env[FLOW_ENV];
  else process.env[FLOW_ENV] = value;
  return () => {
    if (previous === undefined) delete process.env[FLOW_ENV];
    else process.env[FLOW_ENV] = previous;
  };
}

export async function createFlow(
  prisma: PrismaService,
  realmId: string,
  name: string,
  steps: Steps,
) {
  return prisma.authenticationFlow.create({
    data: { realmId, name, steps: steps as never },
  });
}

/** Binds `flowId` as the realm's browser flow and turns custom flows on. */
export async function bindRealm(
  prisma: PrismaService,
  realmId: string,
  flowId: string | null,
  enabled = true,
) {
  await prisma.realm.update({
    where: { id: realmId },
    data: { browserFlowId: flowId, authFlowsEnabled: enabled },
  });
}

export function authorizeUrl(
  realm: string,
  params: Record<string, string> = {},
): string {
  const qs = new URLSearchParams({
    client_id: 'test-client',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid',
    state: 'xyz',
    nonce: 'n-1',
    ...params,
  });
  return `/realms/${realm}/protocol/openid-connect/auth?${qs.toString()}`;
}

/** The code of an authorization response at REDIRECT_URI. */
export function codeFrom(location: string | undefined, state = 'xyz'): string {
  expect(location).toBeTruthy();
  const url = new URL(location as string);
  expect(`${url.origin}${url.pathname}`).toBe(REDIRECT_URI);
  expect(url.searchParams.get('state')).toBe(state);
  const code = url.searchParams.get('code');
  expect(code).toBeTruthy();
  return code as string;
}

export function isCodeResponse(location: string | undefined): boolean {
  return (
    !!location &&
    location.startsWith(REDIRECT_URI) &&
    location.includes('code=')
  );
}

export async function idTokenClaims(
  app: INestApplication<App>,
  realm: string,
  code: string,
  clientId = 'test-client',
): Promise<Record<string, unknown>> {
  const res = await request(app.getHttpServer())
    .post(`/realms/${realm}/protocol/openid-connect/token`)
    .type('form')
    .send({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      client_secret: 'test-client-secret',
    })
    .expect(200);
  const payload = (res.body as { id_token: string }).id_token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

export async function createUser(
  prisma: PrismaService,
  realmId: string,
  username: string,
) {
  return prisma.user.create({
    data: {
      realmId,
      username,
      email: `${username}@example.test`,
      emailVerified: true,
      enabled: true,
      passwordHash: await argon2.hash(PASSWORD),
      passwordChangedAt: new Date(),
    },
  });
}

/** A second confidential client of the realm, at the same redirect URI. */
export async function createClient(
  prisma: PrismaService,
  realmId: string,
  clientId: string,
  data: Record<string, unknown> = {},
) {
  return prisma.client.create({
    data: {
      realmId,
      clientId,
      clientSecret: await argon2.hash('test-client-secret'),
      clientType: 'CONFIDENTIAL',
      redirectUris: [REDIRECT_URI],
      webOrigins: [],
      grantTypes: ['authorization_code'],
      ...data,
    },
  });
}

export interface Totp {
  /** A fresh code: used codes are forgotten first (replay protection). */
  code(): Promise<string>;
}

/** Enrols an authenticator app for the user, as the account page does. */
export async function enrolTotp(
  app: INestApplication<App>,
  prisma: PrismaService,
  userId: string,
  realm: string,
  username: string,
): Promise<Totp> {
  const mfa = app.get(MfaService);
  const { secret } = await mfa.setupTotp(userId, realm, username);
  const OTPAuth = await import('otpauth');
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  });
  await mfa.verifyAndActivateTotp(userId, totp.generate());
  return {
    async code() {
      await prisma.usedTotpCode.deleteMany({ where: { userId } });
      return totp.generate();
    },
  };
}

/** Registers a soft passkey for the user directly in the database. */
export async function registerPasskey(
  prisma: PrismaService,
  userId: string,
  realmId: string,
  authenticator: SoftAuthenticator,
) {
  await prisma.webAuthnCredential.create({
    data: {
      userId,
      realmId,
      credentialId: authenticator.id,
      publicKey: authenticator.cosePublicKey(),
      counter: 0,
      transports: ['internal'],
      deviceType: 'singleDevice',
    },
  });
}

/** Codes issued to `userId` so far. */
export function codeCount(prisma: PrismaService, userId: string) {
  return prisma.authorizationCode.count({ where: { userId } });
}
