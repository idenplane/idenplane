import { createHash, randomBytes } from 'node:crypto';
import {
  AUTHN_TXN_TTL_MS,
  AUTHN_TXN_TYPE,
  AuthnTransactionStore,
  type AuthnTxnState,
} from './authn-transaction.store.js';
import { isMintedFlowSessionProof } from '../authn-core/flow-contracts.js';

interface Row {
  id: string;
  tokenHash: string;
  type: string;
  data: unknown;
  attempts: number;
  expiresAt: Date;
}

type Where = {
  id?: string;
  tokenHash?: string;
  type?: string;
  attempts?: number;
  expiresAt?: { gt: Date };
};

/** An in-memory `pendingAction` with the compare-and-set semantics of SQL. */
function fakePendingActions() {
  const rows = new Map<string, Row>();
  let seq = 0;
  const matches = (r: Row, w: Where) =>
    (w.id === undefined || r.id === w.id) &&
    (w.tokenHash === undefined || r.tokenHash === w.tokenHash) &&
    (w.type === undefined || r.type === w.type) &&
    (w.attempts === undefined || r.attempts === w.attempts) &&
    (w.expiresAt === undefined ||
      r.expiresAt.getTime() > w.expiresAt.gt.getTime());
  return {
    rows,
    create: jest.fn(({ data }: { data: Omit<Row, 'id'> }) => {
      const row = { ...data, id: `txn-${++seq}` } as Row;
      rows.set(row.id, row);
      return Promise.resolve(row);
    }),
    findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) =>
      Promise.resolve(
        [...rows.values()].find((r) => r.tokenHash === where.tokenHash) ?? null,
      ),
    ),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: Where;
        data: {
          attempts?: { increment: number };
          data?: unknown;
          tokenHash?: string;
        };
      }) => {
        let count = 0;
        for (const r of rows.values()) {
          if (!matches(r, where)) continue;
          count += 1;
          if (data.attempts) r.attempts += data.attempts.increment;
          if (data.data !== undefined) r.data = data.data;
          if (data.tokenHash) r.tokenHash = data.tokenHash;
        }
        return Promise.resolve({ count });
      },
    ),
    deleteMany: jest.fn(({ where }: { where: Where }) => {
      let count = 0;
      for (const r of [...rows.values()]) {
        if (matches(r, where)) {
          rows.delete(r.id);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    }),
  };
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

function state(overrides: Partial<AuthnTxnState> = {}): AuthnTxnState {
  return {
    realmId: 'realm-1',
    flowId: 'flow-1',
    flowVersion: 3,
    oauthParams: { client_id: 'app' },
    requestedAcr: [],
    loginHint: null,
    claims: null,
    userId: null,
    mainStepId: 'pw',
    currentStepId: 'pw',
    synthetic: null,
    syntheticDone: [],
    enrolling: false,
    receipts: [],
    rememberMe: false,
    riskStepUp: false,
    riskScore: null,
    riskLevel: null,
    failures: 0,
    ...overrides,
  };
}

describe('AuthnTransactionStore', () => {
  let pending: ReturnType<typeof fakePendingActions>;
  let store: AuthnTransactionStore;
  const t0 = new Date('2026-11-13T10:00:00Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);

  beforeEach(() => {
    pending = fakePendingActions();
    const crypto = {
      sha256,
      generateSecret: () => randomBytes(16).toString('hex'),
    };
    store = new AuthnTransactionStore(
      { pendingAction: pending } as never,
      crypto as never,
    );
  });

  it('stores only the hash of the cookie value, as an authn_txn row', async () => {
    const { txn, token } = await store.create(state(), t0);
    const row = pending.rows.get(txn.id) as Row;
    expect(row.type).toBe(AUTHN_TXN_TYPE);
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.tokenHash).not.toBe(token);
    expect(row.attempts).toBe(0);
    expect(txn.version).toBe(0);
  });

  describe('TTL', () => {
    it('lives 10 minutes from its start and is never extended', async () => {
      const { txn, token } = await store.create(state(), t0);
      expect(txn.expiresAt).toEqual(at(AUTHN_TXN_TTL_MS));
      expect(AUTHN_TXN_TTL_MS).toBe(10 * 60 * 1000);

      expect((await store.find(token, at(AUTHN_TXN_TTL_MS - 1))).status).toBe(
        'active',
      );
      // A write does not move the expiry.
      const begun = await store.begin(txn, at(60_000));
      expect(begun).not.toBeNull();
      expect(pending.rows.get(txn.id)?.expiresAt).toEqual(at(AUTHN_TXN_TTL_MS));
      const late = await store.find(token, at(AUTHN_TXN_TTL_MS));
      expect(late.status).toBe('expired');
    });

    it('refuses every write once expired', async () => {
      const { txn } = await store.create(state(), t0);
      const after = at(AUTHN_TXN_TTL_MS + 1);
      expect(await store.begin(txn, after)).toBeNull();
      expect(await store.commit(txn, state(), {}, after)).toBeNull();
      expect(await store.claim(txn, state({ userId: 'u' }), after)).toBeNull();
    });

    it('reports an unknown token as missing', async () => {
      expect((await store.find('nope', t0)).status).toBe('missing');
      expect((await store.find('', t0)).status).toBe('missing');
    });
  });

  describe('optimistic lock', () => {
    it('lets only one of two requests that read the same version through', async () => {
      const { txn } = await store.create(state(), t0);
      const [a, b] = await Promise.all([
        store.begin(txn, t0),
        store.begin(txn, t0),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect(pending.rows.get(txn.id)?.attempts).toBe(1);
    });

    it('rejects a commit made from a stale version', async () => {
      const { txn } = await store.create(state(), t0);
      const begun = await store.begin(txn, t0);
      expect(begun?.version).toBe(1);
      // A commit from the version read before begin() loses.
      expect(
        await store.commit(txn, state({ failures: 1 }), {}, t0),
      ).toBeNull();
      const ok = await store.commit(begun!, state({ failures: 1 }), {}, t0);
      expect(ok?.txn.version).toBe(2);
      expect((pending.rows.get(txn.id)?.data as AuthnTxnState).failures).toBe(
        1,
      );
    });

    it('rotates the cookie value on request and kills the old one', async () => {
      const { txn, token } = await store.create(state(), t0);
      const committed = await store.commit(
        txn,
        state({ userId: 'user-1' }),
        { rotate: true },
        t0,
      );
      expect(committed?.token).toBeTruthy();
      expect(committed?.token).not.toBe(token);
      expect((await store.find(token, t0)).status).toBe('missing');
      const found = await store.find(committed!.token!, t0);
      expect(found.status).toBe('active');
      expect(found.status === 'active' && found.txn.state.userId).toBe(
        'user-1',
      );
    });

    it('keeps the cookie value when not rotating', async () => {
      const { txn, token } = await store.create(state(), t0);
      const committed = await store.commit(txn, state(), {}, t0);
      expect(committed?.token).toBeUndefined();
      expect((await store.find(token, t0)).status).toBe('active');
    });
  });

  describe('single-use claim', () => {
    it('claims once, with a minted proof, and never again', async () => {
      const { txn, token } = await store.create(
        state({ userId: 'user-1' }),
        t0,
      );
      const proof = await store.claim(txn, undefined, t0);
      expect(proof).toMatchObject({
        kind: 'flow',
        txnId: txn.id,
        realmId: 'realm-1',
        userId: 'user-1',
        flowId: 'flow-1',
        flowVersion: 3,
      });
      expect(isMintedFlowSessionProof(proof!)).toBe(true);
      expect(await store.claim(txn, undefined, t0)).toBeNull();
      expect((await store.find(token, t0)).status).toBe('missing');
    });

    it('lets only one of two concurrent claims win', async () => {
      const { txn } = await store.create(state({ userId: 'user-1' }), t0);
      const results = await Promise.all([
        store.claim(txn, undefined, t0),
        store.claim(txn, undefined, t0),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('refuses a claim from a stale version', async () => {
      const { txn } = await store.create(state({ userId: 'user-1' }), t0);
      await store.begin(txn, t0);
      expect(await store.claim(txn, undefined, t0)).toBeNull();
      expect(pending.rows.has(txn.id)).toBe(true);
    });

    it('refuses a claim before anyone is identified', async () => {
      const { txn } = await store.create(state({ userId: null }), t0);
      expect(await store.claim(txn, undefined, t0)).toBeNull();
    });
  });

  it('destroys a transaction', async () => {
    const { txn, token } = await store.create(state(), t0);
    await store.destroy(txn.id);
    expect((await store.find(token, t0)).status).toBe('missing');
  });
});
