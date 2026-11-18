import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { IdentityProvider, Realm } from '@prisma/client';
import {
  SamlBrokerService,
  SAML_BROKER_COOKIE,
} from './saml-broker.service.js';
import { externalUserFromAssertion } from './saml-attribute-mapping.js';
import {
  encodeResponse,
  makeFakeIdp,
  responseXml,
  type FakeIdp,
  type FakeResponseOptions,
} from './__mocks__/fake-saml-idp.js';
import {
  validateSamlConfig,
  NAMEID_FORMATS,
} from '../../identity-providers/saml-config.js';
import type { VerifiedSamlAssertion } from './saml-response-verifier.js';

const BASE_URL = 'https://iam.example.com';
const REALM = { id: 'realm-1', name: 'acme' } as Realm;
const SP_ENTITY = `${BASE_URL}/realms/acme/broker/okta/saml/metadata`;
const ACS = `${BASE_URL}/realms/acme/broker/okta/saml/acs`;

const realmKeys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

type Row = Record<string, any>;

/** Just enough of Prisma for the service, with real unique constraints. */
function memoryPrisma(idp: IdentityProvider) {
  const requests: Row[] = [];
  const assertionIds: Row[] = [];
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('gt' in v) return row[k] > v.gt;
        if ('lte' in v) return row[k] <= v.lte;
        if ('lt' in v) return row[k] < v.lt;
        if ('not' in v) return row[k] !== v.not;
      }
      return row[k] === v;
    });
  const unique = (field: string, value: unknown) => {
    if (value != null && requests.some((r) => r[field] === value)) {
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    }
  };
  return {
    requests,
    assertionIds,
    identityProvider: {
      findUnique: jest.fn(async () => idp),
    },
    samlBrokerRequest: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        unique('startHandle', data['startHandle']);
        const row = {
          id: randomUUID(),
          requestId: null,
          relayState: null,
          bindingHash: null,
          result: null,
          startedAt: null,
          verifiedAt: null,
          createdAt: new Date(),
          ...data,
        };
        requests.push(row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: { where: Row }) =>
          requests.find((r) => matches(r, where)) ?? null,
      ),
      updateMany: jest.fn(
        async ({ where, data }: { where: Row; data: Row }) => {
          const hit = requests.filter((r) => matches(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: Row }) => {
        const before = requests.length;
        for (let i = requests.length - 1; i >= 0; i--) {
          if (matches(requests[i], where)) requests.splice(i, 1);
        }
        return { count: before - requests.length };
      }),
    },
    samlBrokerAssertionId: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        if (
          assertionIds.some(
            (a) =>
              a['identityProviderId'] === data['identityProviderId'] &&
              a['assertionId'] === data['assertionId'],
          )
        ) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        assertionIds.push({ ...data, createdAt: new Date() });
        return data;
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: Row; data: Row }) => {
          const hit = assertionIds.filter((r) => matches(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        },
      ),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  };
}

function fakeRes() {
  const res: any = {
    cookies: {} as Record<string, string>,
    headers: {} as Record<string, string>,
    location: undefined as string | undefined,
    body: undefined as string | undefined,
    cookie: jest.fn((name: string, value: string) => {
      res.cookies[name] = value;
    }),
    redirect: jest.fn((_status: number, url: string) => {
      res.location = url;
    }),
    setHeader: jest.fn((k: string, v: string) => {
      res.headers[k] = v;
    }),
    type: jest.fn(() => ({
      send: (body: string) => {
        res.body = body;
      },
    })),
  };
  return res;
}

let fakeIdp: FakeIdp;
beforeAll(async () => {
  fakeIdp = await makeFakeIdp();
});

describe('SamlBrokerService', () => {
  let prisma: ReturnType<typeof memoryPrisma>;
  let service: SamlBrokerService;
  let idp: IdentityProvider;

  const setup = (
    configOver: Record<string, unknown> = {},
    trustEmail = true,
  ) => {
    idp = {
      id: 'idp-1',
      realmId: REALM.id,
      alias: 'okta',
      displayName: 'Okta',
      enabled: true,
      providerType: 'saml',
      clientId: '',
      clientSecret: '',
      authorizationUrl: '',
      tokenUrl: '',
      userinfoUrl: null,
      jwksUrl: null,
      issuer: null,
      defaultScopes: '',
      trustEmail,
      linkOnly: false,
      syncUserProfile: true,
      samlConfig: {
        entityId: fakeIdp.entityId,
        ssoUrl: 'https://idp.example.test/sso',
        signingCertificates: [fakeIdp.certificatePem],
        ...configOver,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as IdentityProvider;
    prisma = memoryPrisma(idp);
    service = new SamlBrokerService(
      prisma as any,
      {
        activeSigningKey: jest.fn(async () => ({
          kid: 'k',
          algorithm: 'RS256',
          publicKey: realmKeys.publicKey,
          privateKey: realmKeys.privateKey,
          createdAt: new Date(),
        })),
      } as any,
      { isLeader: () => true } as any,
    );
  };

  beforeEach(() => {
    process.env['BASE_URL'] = BASE_URL;
    setup();
  });
  afterEach(() => {
    delete process.env['BASE_URL'];
  });

  const state = {
    realmId: REALM.id,
    realmName: REALM.name,
    alias: 'okta',
    clientId: 'app',
    redirectUri: 'https://app.example.com/cb',
  };

  /** Runs createStart and start; returns what the IdP and browser hold. */
  async function begin() {
    const startUrl = await service.createStart(REALM, idp, state);
    const handle = new URL(startUrl, BASE_URL).searchParams.get('h');
    const res = fakeRes();
    await service.start(REALM, 'okta', handle, res);
    const location = new URL(res.location as string);
    const xml = inflateRawSync(
      Buffer.from(location.searchParams.get('SAMLRequest')!, 'base64'),
    ).toString('utf-8');
    const requestId = /ID="([^"]+)"/.exec(xml)![1];
    return {
      handle,
      requestId,
      relayState: location.searchParams.get('RelayState')!,
      cookie: res.cookies[SAML_BROKER_COOKIE] as string,
      res,
    };
  }

  const idpResponse = (
    requestId: string,
    over: Partial<FakeResponseOptions> = {},
  ) =>
    encodeResponse(
      responseXml({
        idp: fakeIdp,
        spEntityId: SP_ENTITY,
        acsUrl: ACS,
        requestId,
        attributes: {
          email: ['jane@example.com'],
          firstName: ['Jane'],
          lastName: ['Doe'],
        },
        ...over,
      }),
    );

  describe('start', () => {
    it('sends a Redirect-binding AuthnRequest with a short RelayState and binds the browser', async () => {
      const { relayState, cookie, res, requestId } = await begin();
      expect(relayState.length).toBeLessThanOrEqual(80);
      expect(cookie).toBeTruthy();
      expect(res.cookie).toHaveBeenCalledWith(
        SAML_BROKER_COOKIE,
        cookie,
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/realms/acme/broker/okta/saml',
        }),
      );
      const row = prisma.requests[0];
      expect(row['requestId']).toBe(requestId);
      expect(row['bindingHash']).toBe(
        createHash('sha256').update(cookie).digest('hex'),
      );
    });

    it('a start link works once', async () => {
      const { handle } = await begin();
      await expect(
        service.start(REALM, 'okta', handle, fakeRes()),
      ).rejects.toThrow(BadRequestException);
    });

    it('POST binding: a signed AuthnRequest in a nonce-scripted form with its own CSP', async () => {
      setup({ ssoBinding: 'post', signAuthnRequests: true });
      const startUrl = await service.createStart(REALM, idp, state);
      const res = fakeRes();
      await service.start(
        REALM,
        'okta',
        new URL(startUrl, BASE_URL).searchParams.get('h'),
        res,
      );
      expect(res.body).toContain('action="https://idp.example.test/sso"');
      const xml = Buffer.from(
        /name="SAMLRequest" value="([^"]+)"/.exec(res.body)![1],
        'base64',
      ).toString('utf-8');
      expect(xml).toContain('<Signature');
      expect(res.headers['Content-Security-Policy']).toMatch(
        /form-action https:\/\/idp\.example\.test/,
      );
    });

    it('refuses a provider that is not SAML', async () => {
      setup();
      (idp as any).providerType = 'oidc';
      await expect(
        service.start(REALM, 'okta', 'x'.repeat(43), fakeRes()),
      ).rejects.toThrow(/not a SAML identity provider/);
    });
  });

  describe('acs and complete', () => {
    it('verifies the response, then hands the identity to the bound browser once', async () => {
      const b = await begin();
      const next = await service.acs(
        REALM,
        'okta',
        idpResponse(b.requestId),
        b.relayState,
      );
      const id = new URL(next, BASE_URL).searchParams.get('id');
      const done = await service.complete(REALM, 'okta', id, b.cookie);
      expect(done.state).toMatchObject({ clientId: 'app' });
      expect(done.identity?.external).toMatchObject({
        sub: 'user-123',
        email: 'jane@example.com',
        emailVerified: true,
        givenName: 'Jane',
        familyName: 'Doe',
      });
      // Once only.
      await expect(
        service.complete(REALM, 'okta', id, b.cookie),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a response to another AuthnRequest (InResponseTo)', async () => {
      const b = await begin();
      await expect(
        service.acs(
          REALM,
          'okta',
          idpResponse('_some-other-request'),
          b.relayState,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('refuses a replayed response (the same POST twice)', async () => {
      const b = await begin();
      const posted = idpResponse(b.requestId);
      await service.acs(REALM, 'okta', posted, b.relayState);
      await expect(
        service.acs(REALM, 'okta', posted, b.relayState),
      ).rejects.toThrow(/expired or was already completed/);
    });

    it('refuses a replayed assertion ID', async () => {
      const until = new Date(Date.now() + 60_000);
      await service.claimAssertionId(idp, '_a1', until);
      await expect(service.claimAssertionId(idp, '_a1', until)).rejects.toThrow(
        /already used/,
      );
      // A record whose time has passed is taken over.
      prisma.assertionIds[0]['expiresAt'] = new Date(Date.now() - 1000);
      await expect(
        service.claimAssertionId(idp, '_a1', until),
      ).resolves.toBeUndefined();
    });

    it('refuses an unknown or missing RelayState (no IdP-initiated sign-in)', async () => {
      await expect(
        service.acs(REALM, 'okta', idpResponse('_x'), undefined),
      ).rejects.toThrow(/IdP-initiated/);
      await expect(
        service.acs(REALM, 'okta', idpResponse('_x'), 'nope'),
      ).rejects.toThrow(BadRequestException);
    });

    it('only the browser that started can finish (login CSRF)', async () => {
      const b = await begin();
      const next = await service.acs(
        REALM,
        'okta',
        idpResponse(b.requestId),
        b.relayState,
      );
      const id = new URL(next, BASE_URL).searchParams.get('id');
      await expect(
        service.complete(REALM, 'okta', id, 'another-browser'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.complete(REALM, 'okta', id, undefined),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a non-Success status ends the attempt without an identity', async () => {
      const b = await begin();
      const next = await service.acs(
        REALM,
        'okta',
        idpResponse(b.requestId, {
          status: 'urn:oasis:names:tc:SAML:2.0:status:AuthnFailed',
          signAssertion: false,
        }),
        b.relayState,
      );
      const id = new URL(next, BASE_URL).searchParams.get('id');
      const done = await service.complete(REALM, 'okta', id, b.cookie);
      expect(done.identity).toBeNull();
    });

    it('an expired sign-in cannot be completed at the ACS', async () => {
      const b = await begin();
      prisma.requests[0]['expiresAt'] = new Date(Date.now() - 1);
      await expect(
        service.acs(REALM, 'okta', idpResponse(b.requestId), b.relayState),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

describe('externalUserFromAssertion', () => {
  const cfg = (over: Record<string, unknown> = {}) => {
    const r = validateSamlConfig({
      entityId: 'https://idp',
      ssoUrl: 'https://idp/sso',
      signingCertificates: [fakeIdp.certificatePem],
      ...over,
    });
    if (!r.ok) throw new Error(r.errors.join());
    return r.config;
  };
  const assertion = (
    over: Partial<VerifiedSamlAssertion> = {},
  ): VerifiedSamlAssertion => ({
    responseId: '_r',
    assertionId: '_a',
    issuer: 'https://idp',
    nameId: 'opaque-1',
    nameIdFormat: NAMEID_FORMATS.persistent,
    sessionIndex: null,
    attributes: {
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': [
        'jane@example.com',
      ],
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname': [
        'Jane',
      ],
    },
    replayUntil: 0,
    signed: { response: false, assertion: true },
    ...over,
  });

  it('maps the Entra claim names by default; email is verified only with trustEmail', () => {
    expect(externalUserFromAssertion(assertion(), cfg(), false)).toMatchObject({
      sub: 'opaque-1',
      email: 'jane@example.com',
      emailVerified: false,
      givenName: 'Jane',
      preferredUsername: 'jane@example.com',
    });
    expect(
      externalUserFromAssertion(assertion(), cfg(), true).emailVerified,
    ).toBe(true);
  });

  it('uses only the configured attribute when one is mapped', () => {
    const out = externalUserFromAssertion(
      assertion({
        attributes: { mail: ['x@example.com'], email: ['y@example.com'] },
      }),
      cfg({ attributes: { email: 'mail' } }),
      true,
    );
    expect(out.email).toBe('x@example.com');
  });

  it('takes the link key from the subject attribute when set, and refuses its absence', () => {
    expect(
      externalUserFromAssertion(
        assertion({ attributes: { objectId: ['oid-9'] } }),
        cfg({ subjectAttribute: 'objectId' }),
        false,
      ).sub,
    ).toBe('oid-9');
    expect(() =>
      externalUserFromAssertion(
        assertion({ attributes: {} }),
        cfg({ subjectAttribute: 'objectId' }),
        false,
      ),
    ).toThrow(/subject attribute/);
  });

  it('never links on a transient NameID', () => {
    expect(() =>
      externalUserFromAssertion(
        assertion({ nameIdFormat: NAMEID_FORMATS.transient }),
        cfg({ nameIdFormat: NAMEID_FORMATS.unspecified }),
        false,
      ),
    ).toThrow(/transient/);
  });

  it('uses an emailAddress NameID as the email when no attribute carries one', () => {
    expect(
      externalUserFromAssertion(
        assertion({
          nameId: 'bob@example.com',
          nameIdFormat: NAMEID_FORMATS.emailAddress,
          attributes: {},
        }),
        cfg({ nameIdFormat: NAMEID_FORMATS.emailAddress }),
        true,
      ),
    ).toMatchObject({ email: 'bob@example.com', emailVerified: true });
  });

  it('drops a value that is not an email address', () => {
    expect(
      externalUserFromAssertion(
        assertion({ attributes: { email: ['not-an-email'] } }),
        cfg(),
        true,
      ).email,
    ).toBeUndefined();
  });
});
