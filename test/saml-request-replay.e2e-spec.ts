import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import request from 'supertest';
import {
  generateKeyPairSync,
  randomUUID,
  sign as cryptoSign,
} from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { SignedXml } from 'xml-crypto';
import { createTestApp, type SeededRealm, type TestContext } from './setup';
import { SamlIdpService } from '../src/saml/saml-idp.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CachedLookupsService } from '../src/cache/cached-lookups.service';
import { CryptoService } from '../src/crypto/crypto.service';
import { LeaderService } from '../src/cache/leader.service';
import type { SamlServiceProvider } from '@prisma/client';

/**
 * AuthnRequests against a real PostgreSQL: a request is accepted once, by
 * whichever process gets it first; stale requests are refused; signed
 * requests are verified over both bindings end to end.
 */
describe('SAML AuthnRequest replay and signatures (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestContext;
  let seeded: SeededRealm;
  let unsignedSp: SamlServiceProvider;
  let signedSp: SamlServiceProvider;
  let keys: { publicKey: string; privateKey: string };

  const REALM = 'e2e-saml-replay';
  const UNSIGNED_SP = 'https://unsigned-sp.example.test/metadata';
  const SIGNED_SP = 'https://signed-sp.example.test/metadata';
  const ACS = 'https://sp.example.test/acs';
  const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  const SSO = `/realms/${REALM}/protocol/saml`;

  const authnRequest = (
    issuer: string,
    id: string,
    issueInstant = new Date().toISOString(),
  ) =>
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${issueInstant}" AssertionConsumerServiceURL="${ACS}"><saml:Issuer>${issuer}</saml:Issuer></samlp:AuthnRequest>`;

  /** An HTTP-Redirect URL, signed when a key is given. */
  const redirectUrl = (
    xml: string,
    relayStateRaw?: string,
    privateKey?: string,
  ) => {
    let qs = `SAMLRequest=${encodeURIComponent(
      deflateRawSync(Buffer.from(xml)).toString('base64'),
    )}`;
    if (relayStateRaw !== undefined) qs += `&RelayState=${relayStateRaw}`;
    if (privateKey) {
      qs += `&SigAlg=${encodeURIComponent(RSA_SHA256)}`;
      const sig = cryptoSign('sha256', Buffer.from(qs), privateKey);
      qs += `&Signature=${encodeURIComponent(sig.toString('base64'))}`;
    }
    return `${SSO}?${qs}`;
  };

  /** The service as another worker or replica runs it: its own pool. */
  const otherProcess = () => {
    const prisma = new PrismaService();
    const service = new SamlIdpService(
      app.get(CachedLookupsService),
      prisma,
      app.get(CryptoService),
      { isLeader: () => false } as never,
    );
    return { prisma, service };
  };

  const parsedRequest = (id: string) => ({
    id,
    issuer: UNSIGNED_SP,
    issueInstant: new Date().toISOString(),
    destination: null,
    acsUrl: null,
    protocolBinding: null,
    nameIdPolicy: null,
    forceAuthn: false,
    isPassive: false,
    requestedAuthnContext: null,
  });

  beforeAll(async () => {
    keys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    ctx = await createTestApp();
    app = ctx.app;
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    seeded = await ctx.seedTestRealm(REALM);
    unsignedSp = await ctx.prisma.samlServiceProvider.create({
      data: {
        realmId: seeded.realm.id,
        entityId: UNSIGNED_SP,
        name: 'Unsigned SP',
        acsUrl: ACS,
        validRedirectUris: [],
      },
    });
    signedSp = await ctx.prisma.samlServiceProvider.create({
      data: {
        realmId: seeded.realm.id,
        entityId: SIGNED_SP,
        name: 'Signed SP',
        acsUrl: ACS,
        certificate: keys.publicKey,
        validRedirectUris: [],
      },
    });
  }, 30_000);

  afterAll(async () => {
    await ctx.prisma.realm.delete({ where: { name: REALM } }).catch(() => {});
    await ctx.cleanup();
  });

  it('accepts a request once and refuses the same request again', async () => {
    const url = redirectUrl(
      authnRequest(UNSIGNED_SP, `_${randomUUID()}`),
      'rs',
    );
    const first = await request(app.getHttpServer()).get(url);
    expect(first.status).toBe(302);
    expect(first.headers['location']).toBe(`/realms/${REALM}/login?saml=1`);

    const replay = await request(app.getHttpServer()).get(url);
    expect(replay.status).toBe(400);
    expect(replay.body.message).toBe('AuthnRequest has already been used');
  });

  it('refuses the ID on another process with its own database connection', async () => {
    const id = `_${randomUUID()}`;
    const first = await request(app.getHttpServer()).get(
      redirectUrl(authnRequest(UNSIGNED_SP, id)),
    );
    expect(first.status).toBe(302);

    const other = otherProcess();
    try {
      await expect(
        other.service.claimRequestId(unsignedSp, parsedRequest(id)),
      ).rejects.toThrow('AuthnRequest has already been used');
    } finally {
      await other.prisma.$disconnect();
    }
  });

  it('lets exactly one of many simultaneous claims on two processes through', async () => {
    const id = `_${randomUUID()}`;
    const mine = app.get(SamlIdpService);
    const other = otherProcess();
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 ? other.service : mine).claimRequestId(
            unsignedSp,
            parsedRequest(id),
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await ctx.prisma.samlRequestId.count({
          where: { spId: unsignedSp.id, requestId: id },
        }),
      ).toBe(1);
    } finally {
      await other.prisma.$disconnect();
    }
  });

  it('refuses a request issued too long ago', async () => {
    const old = new Date(Date.now() - 30 * 60_000).toISOString();
    const res = await request(app.getHttpServer()).get(
      redirectUrl(authnRequest(UNSIGNED_SP, `_${randomUUID()}`, old)),
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'AuthnRequest has expired or is not yet valid',
    );
  });

  it('deletes expired IDs, and an ID whose window has passed is accepted again', async () => {
    const id = `_${randomUUID()}`;
    const service = app.get(SamlIdpService);
    await service.claimRequestId(unsignedSp, parsedRequest(id));
    await ctx.prisma.samlRequestId.updateMany({
      where: { spId: unsignedSp.id, requestId: id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    // Not yet cleaned up: taken over.
    await expect(
      service.claimRequestId(unsignedSp, parsedRequest(id)),
    ).resolves.toBeUndefined();

    await ctx.prisma.samlRequestId.updateMany({
      where: { spId: unsignedSp.id, requestId: id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    // The clean-up runs on the elected leader only; this app may not be it
    // while other test files' apps hold the lock.
    jest.spyOn(app.get(LeaderService), 'isLeader').mockReturnValue(true);
    await service.cleanupExpiredRequestIds();
    expect(
      await ctx.prisma.samlRequestId.count({
        where: { spId: unsignedSp.id, requestId: id },
      }),
    ).toBe(0);
  });

  describe('a service provider with a certificate', () => {
    it('accepts a signed Redirect request, and refuses it replayed', async () => {
      const url = redirectUrl(
        authnRequest(SIGNED_SP, `_${randomUUID()}`),
        'a%2fb',
        keys.privateKey,
      );
      const first = await request(app.getHttpServer()).get(url);
      expect(first.status).toBe(302);
      const replay = await request(app.getHttpServer()).get(url);
      expect(replay.status).toBe(400);
      expect(replay.body.message).toBe('AuthnRequest has already been used');
    });

    it('refuses a Redirect request whose RelayState was changed', async () => {
      const url = redirectUrl(
        authnRequest(SIGNED_SP, `_${randomUUID()}`),
        'good',
        keys.privateKey,
      ).replace('RelayState=good', 'RelayState=evil');
      const res = await request(app.getHttpServer()).get(url);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('AuthnRequest signature validation failed');
    });

    it('refuses an unsigned Redirect request', async () => {
      const res = await request(app.getHttpServer()).get(
        redirectUrl(authnRequest(SIGNED_SP, `_${randomUUID()}`)),
      );
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('AuthnRequest is not signed');
    });

    it('accepts a signed POST request, and refuses an unsigned one', async () => {
      const id = `_${randomUUID()}`;
      const sig = new SignedXml({
        privateKey: keys.privateKey,
        signatureAlgorithm: RSA_SHA256,
        canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
      });
      sig.addReference({
        xpath: `//*[@ID='${id}']`,
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        transforms: [
          'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
          'http://www.w3.org/2001/10/xml-exc-c14n#',
        ],
      });
      sig.computeSignature(authnRequest(SIGNED_SP, id), {
        location: {
          reference: "/*/*[local-name(.)='Issuer']",
          action: 'after',
        },
      });
      const signed = await request(app.getHttpServer())
        .post(SSO)
        .type('form')
        .send({
          SAMLRequest: Buffer.from(sig.getSignedXml()).toString('base64'),
          RelayState: 'rs',
        });
      expect(signed.status).toBe(302);

      const unsigned = await request(app.getHttpServer())
        .post(SSO)
        .type('form')
        .send({
          SAMLRequest: Buffer.from(
            authnRequest(SIGNED_SP, `_${randomUUID()}`),
          ).toString('base64'),
        });
      expect(unsigned.status).toBe(400);
      expect(unsigned.body.message).toBe('AuthnRequest is not signed');
    });
  });

  it('removes a service provider’s request IDs with it', async () => {
    const sp = await ctx.prisma.samlServiceProvider.create({
      data: {
        realmId: seeded.realm.id,
        entityId: `https://${randomUUID()}.example.test`,
        name: 'Short-lived SP',
        acsUrl: ACS,
        validRedirectUris: [],
      },
    });
    await app
      .get(SamlIdpService)
      .claimRequestId(sp, { ...parsedRequest(`_${randomUUID()}`) });
    await ctx.prisma.samlServiceProvider.delete({ where: { id: sp.id } });
    expect(
      await ctx.prisma.samlRequestId.count({ where: { spId: sp.id } }),
    ).toBe(0);
  });
});
