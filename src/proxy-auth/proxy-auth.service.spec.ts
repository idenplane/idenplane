import { createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import type { ProxyApplication, User } from '@prisma/client';
import { ProxyAuthService } from './proxy-auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../crypto/crypto.service.js';

/**
 * A minimal in-memory stand-in for the two crypto primitives this service uses.
 * `encrypt`/`decrypt` model AES-GCM's property that matters here — tampering is
 * detected rather than silently accepted — so the state tests exercise the real
 * failure mode without needing a key.
 */
class FakeCrypto {
  private counter = 0;

  generateSecret(): string {
    return `secret-${++this.counter}`;
  }

  /**
   * A real hash, not a `sha256(<input>)` label. The "we never persist the raw
   * token" assertion below is only meaningful if the digest does not contain
   * its own input — a stub that embeds it would pass the test while proving
   * nothing.
   */
  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  encrypt(plaintext: string): string {
    return `enc:${Buffer.from(plaintext).toString('base64')}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith('enc:')) {
      throw new Error('auth tag mismatch');
    }
    return Buffer.from(ciphertext.slice(4), 'base64').toString('utf8');
  }
}

const app = (overrides: Partial<ProxyApplication> = {}): ProxyApplication =>
  ({
    id: 'app-1',
    realmId: 'realm-1',
    slug: 'grafana',
    name: 'Grafana',
    enabled: true,
    clientId: 'client-1',
    allowedRedirectUris: ['https://grafana.example.com/*'],
    cookieDomain: '.example.com',
    cookieTtl: 28_800,
    userHeader: 'X-Forwarded-User',
    emailHeader: 'X-Forwarded-Email',
    nameHeader: 'X-Forwarded-Preferred-Username',
    groupsHeader: 'X-Forwarded-Groups',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as ProxyApplication;

const request = (headers: Record<string, string>): Request =>
  ({ headers }) as unknown as Request;

describe('ProxyAuthService', () => {
  let service: ProxyAuthService;
  let prisma: {
    proxySession: {
      create: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
    userGroup: { findMany: jest.Mock };
    proxyApplication: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      proxySession: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userGroup: { findMany: jest.fn().mockResolvedValue([]) },
      proxyApplication: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: new FakeCrypto() },
      ],
    }).compile();

    service = module.get(ProxyAuthService);
  });

  // ─── reconstructOriginalUrl ───────────────────────────────

  describe('reconstructOriginalUrl', () => {
    it('rebuilds the URL from the Traefik/Caddy forwarded headers', () => {
      expect(
        service.reconstructOriginalUrl(
          request({
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'grafana.example.com',
            'x-forwarded-uri': '/d/abc?from=now-6h',
          }),
        ),
      ).toBe('https://grafana.example.com/d/abc?from=now-6h');
    });

    it('prefers X-Original-URL, which is what the nginx auth_request config sets', () => {
      expect(
        service.reconstructOriginalUrl(
          request({
            'x-original-url': 'https://grafana.example.com/dashboards',
            'x-forwarded-proto': 'http',
            'x-forwarded-host': 'ignored.example.com',
          }),
        ),
      ).toBe('https://grafana.example.com/dashboards');
    });

    it('defaults the path when the proxy sends no URI', () => {
      expect(
        service.reconstructOriginalUrl(
          request({
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'grafana.example.com',
          }),
        ),
      ).toBe('https://grafana.example.com/');
    });

    it('returns null when the proxy sent nothing usable', () => {
      expect(service.reconstructOriginalUrl(request({}))).toBeNull();
    });
  });

  // ─── resolveReturnUrl ─────────────────────────────────────

  describe('resolveReturnUrl', () => {
    it('accepts a URL covered by the allowlist wildcard', () => {
      expect(
        service.resolveReturnUrl(app(), 'https://grafana.example.com/d/abc'),
      ).toBe('https://grafana.example.com/d/abc');
    });

    it('rejects a host outside the allowlist', () => {
      expect(
        service.resolveReturnUrl(app(), 'https://evil.test/steal'),
      ).toBeNull();
    });

    it('rejects a lookalike host that merely starts with an allowed one', () => {
      expect(
        service.resolveReturnUrl(
          app(),
          'https://grafana.example.com.evil.test/',
        ),
      ).toBeNull();
    });

    it('rejects javascript: even when the allowlist ends in a wildcard', () => {
      expect(
        service.resolveReturnUrl(
          app({ allowedRedirectUris: ['javascript:/*'] }),
          'javascript:alert(1)',
        ),
      ).toBeNull();
    });

    it('rejects a protocol-relative URL', () => {
      expect(service.resolveReturnUrl(app(), '//evil.test/')).toBeNull();
    });

    it('rejects a null candidate rather than falling back to anything', () => {
      expect(service.resolveReturnUrl(app(), null)).toBeNull();
    });
  });

  // ─── handshake state ──────────────────────────────────────

  describe('state', () => {
    const returnUrl = 'https://grafana.example.com/d/abc';

    it('round-trips a return URL', () => {
      const state = service.encodeState(app(), returnUrl);
      expect(service.decodeState(app(), state)).toBe(returnUrl);
    });

    it('rejects a tampered state', () => {
      expect(service.decodeState(app(), 'not-really-encrypted')).toBeNull();
    });

    it('rejects a missing state', () => {
      expect(service.decodeState(app(), undefined)).toBeNull();
    });

    it('rejects a state minted for a different application', () => {
      const state = service.encodeState(app({ id: 'app-2' }), returnUrl);
      expect(service.decodeState(app({ id: 'app-1' }), state)).toBeNull();
    });

    it('rejects an expired state', () => {
      const state = service.encodeState(app(), returnUrl);
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(new Date('2099-01-01').getTime());
      expect(service.decodeState(app(), state)).toBeNull();
      jest.restoreAllMocks();
    });

    it('re-checks the allowlist on decode, so tightening it takes effect mid-handshake', () => {
      const state = service.encodeState(app(), returnUrl);
      const tightened = app({
        allowedRedirectUris: ['https://other.example.com/*'],
      });
      expect(service.decodeState(tightened, state)).toBeNull();
    });
  });

  // ─── sessions ─────────────────────────────────────────────

  describe('validateSession', () => {
    const user = { id: 'user-1', enabled: true } as User;

    it('returns the user for a live session', async () => {
      prisma.proxySession.findUnique.mockResolvedValue({
        proxyApplicationId: 'app-1',
        expiresAt: new Date(Date.now() + 60_000),
        user,
      });

      await expect(service.validateSession(app(), 'tok')).resolves.toBe(user);
    });

    it('refuses a session minted for a different proxy application', async () => {
      prisma.proxySession.findUnique.mockResolvedValue({
        proxyApplicationId: 'app-OTHER',
        expiresAt: new Date(Date.now() + 60_000),
        user,
      });

      await expect(
        service.validateSession(app(), 'tok'),
      ).resolves.toBeNull();
    });

    it('refuses an expired session', async () => {
      prisma.proxySession.findUnique.mockResolvedValue({
        proxyApplicationId: 'app-1',
        expiresAt: new Date(Date.now() - 1),
        user,
      });

      await expect(
        service.validateSession(app(), 'tok'),
      ).resolves.toBeNull();
    });

    it('refuses a session whose user has since been disabled', async () => {
      prisma.proxySession.findUnique.mockResolvedValue({
        proxyApplicationId: 'app-1',
        expiresAt: new Date(Date.now() + 60_000),
        user: { ...user, enabled: false },
      });

      await expect(
        service.validateSession(app(), 'tok'),
      ).resolves.toBeNull();
    });

    it('refuses an absent cookie without touching the database', async () => {
      await expect(
        service.validateSession(app(), undefined),
      ).resolves.toBeNull();
      expect(prisma.proxySession.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('createSession', () => {
    it('persists only the hash of the token it returns', async () => {
      const token = await service.createSession(app(), {
        id: 'user-1',
      } as User);

      const data = prisma.proxySession.create.mock.calls[0][0].data;
      expect(data.tokenHash).toBe(
        createHash('sha256').update(token).digest('hex'),
      );
      expect(JSON.stringify(data)).not.toContain(token);
    });

    it('expires the session after the application cookie TTL', async () => {
      await service.createSession(app({ cookieTtl: 60 }), {
        id: 'user-1',
      } as User);

      const { expiresAt } = prisma.proxySession.create.mock.calls[0][0].data;
      const seconds = (expiresAt.getTime() - Date.now()) / 1000;
      expect(seconds).toBeGreaterThan(55);
      expect(seconds).toBeLessThanOrEqual(60);
    });
  });

  describe('revokeSession', () => {
    it('is a no-op for an absent cookie', async () => {
      await service.revokeSession(undefined);
      expect(prisma.proxySession.delete).not.toHaveBeenCalled();
    });

    it('swallows a delete for an already-gone session', async () => {
      prisma.proxySession.delete.mockRejectedValue(new Error('not found'));
      await expect(service.revokeSession('tok')).resolves.toBeUndefined();
    });
  });

  // ─── identity headers ─────────────────────────────────────

  describe('buildIdentityHeaders', () => {
    const user = {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Smith',
      enabled: true,
    } as User;

    it('uses the configured header names', async () => {
      const headers = await service.buildIdentityHeaders(
        app({
          userHeader: 'X-Auth-Request-User',
          emailHeader: 'X-Auth-Request-Email',
        }),
        user,
      );

      expect(headers['X-Auth-Request-User']).toBe('alice');
      expect(headers['X-Auth-Request-Email']).toBe('alice@example.com');
    });

    it('keeps spaces in a display name', async () => {
      const headers = await service.buildIdentityHeaders(app(), user);
      expect(headers['X-Forwarded-Preferred-Username']).toBe('Alice Smith');
    });

    it('strips CR/LF so a crafted profile field cannot inject a header', async () => {
      const headers = await service.buildIdentityHeaders(app(), {
        ...user,
        username: 'alice\r\nX-Admin: true',
      } as User);

      expect(headers['X-Forwarded-User']).toBe('aliceX-Admin: true');
      expect(headers['X-Forwarded-User']).not.toContain('\r');
      expect(headers['X-Forwarded-User']).not.toContain('\n');
    });

    it('emits every configured header even when the value is empty, so a stale one cannot survive', async () => {
      const headers = await service.buildIdentityHeaders(app(), {
        ...user,
        email: null,
      } as unknown as User);

      expect(Object.keys(headers)).toEqual(
        expect.arrayContaining([
          'X-Forwarded-User',
          'X-Forwarded-Email',
          'X-Forwarded-Preferred-Username',
          'X-Forwarded-Groups',
        ]),
      );
      expect(headers['X-Forwarded-Email']).toBe('');
    });

    it('joins group names with commas', async () => {
      prisma.userGroup.findMany.mockResolvedValue([
        { group: { name: 'admins' } },
        { group: { name: 'viewers' } },
      ]);

      const headers = await service.buildIdentityHeaders(app(), user);
      expect(headers['X-Forwarded-Groups']).toBe('admins,viewers');
    });

    it('falls back to the username when no name is set', async () => {
      const headers = await service.buildIdentityHeaders(app(), {
        ...user,
        firstName: null,
        lastName: null,
      } as unknown as User);

      expect(headers['X-Forwarded-Preferred-Username']).toBe('alice');
    });
  });

  // ─── signOutDestination ───────────────────────────────────

  describe('signOutDestination', () => {
    const realm = { name: 'master' } as never;

    it('prefers a concrete allowed URI over a wildcard one', () => {
      expect(
        service.signOutDestination(
          realm,
          app({
            allowedRedirectUris: [
              'https://grafana.example.com/*',
              'https://grafana.example.com/login',
            ],
          }),
        ),
      ).toBe('https://grafana.example.com/login');
    });

    it('strips a trailing wildcard when that is all there is', () => {
      expect(
        service.signOutDestination(
          realm,
          app({ allowedRedirectUris: ['https://grafana.example.com/*'] }),
        ),
      ).toBe('https://grafana.example.com/');
    });

    it('falls back to the account console when nothing is configured', () => {
      expect(
        service.signOutDestination(realm, app({ allowedRedirectUris: [] })),
      ).toBe('/realms/master/account');
    });

    // The point of the whole helper: sign-out takes no rd parameter, so no
    // request-supplied value can reach res.redirect. Everything it can return
    // is admin-configured.
    it('only ever returns admin-configured values', () => {
      const configured = ['https://grafana.example.com/*'];
      const result = service.signOutDestination(
        realm,
        app({ allowedRedirectUris: configured }),
      );

      expect(
        configured.some((u) => result === u || result === u.slice(0, -1)),
      ).toBe(true);
    });
  });

  // ─── callbackUrl ──────────────────────────────────────────

  describe('callbackUrl', () => {
    const original = process.env['BASE_URL'];
    afterEach(() => {
      if (original === undefined) delete process.env['BASE_URL'];
      else process.env['BASE_URL'] = original;
    });

    it('builds from BASE_URL', () => {
      process.env['BASE_URL'] = 'https://auth.example.com';
      expect(service.callbackUrl('master', 'grafana')).toBe(
        'https://auth.example.com/realms/master/proxy/grafana/callback',
      );
    });

    it('tolerates a trailing slash, so the value stays byte-identical across both hops', () => {
      process.env['BASE_URL'] = 'https://auth.example.com///';
      expect(service.callbackUrl('master', 'grafana')).toBe(
        'https://auth.example.com/realms/master/proxy/grafana/callback',
      );
    });
  });
});
