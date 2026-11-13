import 'reflect-metadata';
import type { Realm } from '@prisma/client';
import { NhiService } from './nhi.service.js';
import { NhiRotationScheduler } from './nhi-rotation.scheduler.js';
import { issue } from '../client-auth/__mocks__/test-pki.js';

const REALM_ID = 'realm-scoped-0001';
const realm = { id: REALM_ID, name: 'scoped' } as Realm;

/** Models whose rows carry a realm; nhiUsageStats has none (scoped through its identity). */
const SCOPED_MODELS = ['nhiIdentity', 'nhiCredential', 'nhiCredentialPolicy'];

interface Call {
  model: string;
  method: string;
  args: unknown;
}

/**
 * Every query NhiService and the rotation scheduler send for an identity,
 * credential or policy names the realm: in `where`, in a compound unique
 * key, or in the row it creates. A query by id alone could reach another
 * realm's row.
 */
describe('NHI realm scoping', () => {
  let calls: Call[];
  let prisma: any;

  const row = {
    id: 'row-1',
    realmId: REALM_ID,
    nhiIdentityId: 'nhi-1',
    name: 'row',
    identityType: 'IOT_DEVICE',
    enabled: true,
    lifecycleStatus: 'SUSPENDED',
    credentialType: 'API_KEY',
    tlsAuthMode: null,
    revoked: false,
    rotationRequired: false,
    supersededById: null,
    rotationGraceUntil: null,
    expiresAt: null,
    certNotBefore: null,
    certNotAfter: null,
    allowedIpRanges: [],
    requestCount: 0,
    createdAt: new Date(),
    rotationIntervalDays: 90,
    rotationBeforeDays: 7,
    maxCredentialAgeDays: 365,
    rotationOverlapSeconds: 60,
    metadata: {},
  };

  const defaults: Record<string, (args: any) => unknown> = {
    findFirst: () => row,
    findUnique: () => null,
    findMany: () => [row],
    count: () => 0,
    create: (args) => ({ ...row, ...args.data, id: 'created' }),
    update: () => row,
    updateMany: () => ({ count: 1 }),
    delete: () => row,
    deleteMany: () => ({ count: 1 }),
  };

  beforeEach(() => {
    calls = [];
    const model = (name: string) =>
      new Proxy(
        {},
        {
          get: (_t, method: string) =>
            jest.fn(async (args: unknown) => {
              calls.push({ model: name, method, args });
              return defaults[method]?.(args);
            }),
        },
      );
    prisma = new Proxy(
      {
        $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
        $queryRaw: async (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          calls.push({
            model: '$queryRaw',
            method: strings.join('?'),
            args: values,
          });
          return [{ id: 'nhi-1' }];
        },
        realm: { findMany: async () => [realm] },
        nhiUsageStats: {
          findUnique: async () => ({ lastActiveAt: null }),
          create: async () => ({}),
        },
      } as Record<string, unknown>,
      {
        get: (target, prop: string) => {
          if (!(prop in target)) target[prop] = model(prop);
          return target[prop];
        },
      },
    );
  });

  function unscoped(): Call[] {
    return calls.filter(
      (call) =>
        (SCOPED_MODELS.includes(call.model) || call.model === '$queryRaw') &&
        !JSON.stringify(call.args).includes(REALM_ID),
    );
  }

  it('NhiService', async () => {
    const crypto = {
      generateSecret: () => 'k'.repeat(64),
      hashPassword: async () => 'hash',
      encrypt: (v: string) => `enc(${v})`,
    };
    const service = new NhiService(prisma, crypto as never);
    const device = await issue({ cn: 'scoped-device' });

    await service.create(realm, { name: 'n' } as never);
    await service.findAll(realm);
    await service.findById(realm, 'nhi-1');
    await service.update(realm, 'nhi-1', { name: 'm' } as never);
    await service.suspend(realm, 'nhi-1');
    await service.reactivate(realm, 'nhi-1');
    await service.decommission(realm, 'nhi-1');
    await service.remove(realm, 'nhi-1');
    await service.createCredential(realm, 'nhi-1', {
      name: 'k',
      credentialType: 'API_KEY',
    });
    await service.createCredential(realm, 'nhi-1', {
      name: 'c',
      tlsAuthMode: 'SELF_SIGNED',
      certificatePem: device.pem,
    });
    await service.listCredentials(realm, 'nhi-1');
    await service.findCredentialById(realm, 'nhi-1', 'row-1');
    await service.revokeCredential(realm, 'nhi-1', 'row-1');
    await service.rotateCredential(realm, 'nhi-1', 'row-1');
    await service.createPolicy(realm, { name: 'p' } as never);
    await service.listPolicies(realm);
    await service.findPolicyById(realm, 'row-1');
    await service.updatePolicy(realm, 'row-1', { name: 'q' } as never);
    await service.removePolicy(realm, 'row-1');
    await service.getApplicablePolicy(realm, 'nhi-1');
    await service.isRotationRequired(realm, 'nhi-1', 'row-1');
    await service.getCredentialsRequiringRotation(realm);
    await service.setCertificate(realm, 'nhi-1', {} as never);
    await service.getUsageStats(realm, 'nhi-1');
    await service.getPolicyRotationStatus(realm, 'row-1');
    await service.getRotationStatusSummary(realm);
    await service.bulkRegistration(realm, {
      devices: [{ name: 'd' }],
    } as never);

    expect(calls.length).toBeGreaterThan(40);
    expect(unscoped()).toEqual([]);
  });

  it('NhiRotationScheduler', async () => {
    defaults.findMany = (args) =>
      args?.select?.rotationOverlapSeconds === undefined &&
      args?.where?.autoRotate
        ? [row]
        : [{ ...row, createdAt: new Date(0) }];
    const scheduler = new NhiRotationScheduler(
      prisma,
      { dispatchEvent: async () => undefined } as never,
      { isLeader: () => true } as never,
    );
    await scheduler.processRotations();
    expect(calls.some((c) => c.method === 'updateMany')).toBe(true);
    expect(unscoped()).toEqual([]);
  });
});
