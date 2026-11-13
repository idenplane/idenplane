import { createHmac } from 'node:crypto';
import {
  EMAIL_OTP_MAX_ATTEMPTS,
  EMAIL_OTP_MAX_FAILURES_PER_USER,
  EMAIL_OTP_MAX_SENDS_PER_USER,
  EmailOtpError,
  EmailOtpService,
} from './email-otp.service.js';

/** One `otp_attempts` table in memory, with the calls the service makes. */
function fakePrisma() {
  type Row = Record<string, any>;
  const rows: Row[] = [];
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('lt' in v) return row[k] < v.lt;
        if ('lte' in v) return row[k] <= v.lte;
        if ('gt' in v) return row[k] > v.gt;
        if ('gte' in v) return row[k] >= v.gte;
      }
      return row[k] === v;
    });
  const otpAttempt = {
    // A copy, as Prisma returns: later updates do not change it.
    findUnique: jest.fn(async ({ where }: Row) => {
      const found = rows.find(
        (r) =>
          r.purpose === where.purpose_bindingHash.purpose &&
          r.bindingHash === where.purpose_bindingHash.bindingHash,
      );
      return found ? { ...found } : null;
    }),
    create: jest.fn(async ({ data }: Row) => {
      const row = {
        id: `r${rows.length + 1}`,
        attempts: 0,
        sendCount: 1,
        ...data,
      };
      rows.push(row);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) {
        for (const [k, v] of Object.entries(data)) {
          r[k] =
            v && typeof v === 'object' && 'increment' in (v as Row)
              ? r[k] + (v as Row).increment
              : v;
        }
      }
      return { count: hit.length };
    }),
    deleteMany: jest.fn(async ({ where }: Row) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i], where)) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    }),
    aggregate: jest.fn(async ({ where }: Row) => {
      const hit = rows.filter((r) => matches(r, where));
      return {
        _sum: {
          sendCount: hit.reduce((n, r) => n + r.sendCount, 0),
          attempts: hit.reduce((n, r) => n + r.attempts, 0),
        },
      };
    }),
  };
  return { rows, prisma: { otpAttempt } };
}

const crypto = {
  hmac: (purpose: string, data: string) =>
    createHmac('sha256', `k:${purpose}`).update(data).digest('hex'),
};

describe('EmailOtpService', () => {
  const realm = { id: 'realm-1', name: 'r' } as never;
  const user = {
    id: 'u1',
    email: 'Jane@Example.test',
    emailVerified: true,
  } as never;
  let fake: ReturnType<typeof fakePrisma>;
  let email: { isConfigured: jest.Mock; sendEmail: jest.Mock };
  let service: EmailOtpService;
  let sentCode: string;

  beforeEach(() => {
    fake = fakePrisma();
    email = {
      isConfigured: jest.fn().mockResolvedValue(true),
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    const themeEmail = {
      renderEmail: jest.fn((_realm, _t, data: { code: string }) => {
        sentCode = data.code;
        return `<p>${data.code}</p>`;
      }),
      getSubject: jest.fn().mockReturnValue('Your sign-in code'),
    };
    service = new EmailOtpService(
      fake.prisma as never,
      crypto as never,
      email as never,
      themeEmail as never,
    );
  });

  const send = (binding = 'txn-1', now = new Date()) =>
    service.send({ realm, user, binding, now });

  it('masks the address', () => {
    expect(EmailOtpService.maskEmail('jane@example.test')).toBe(
      'j•••@example.test',
    );
  });

  it('delivers only to a verified address of a realm with email set up', async () => {
    expect(await service.canDeliver(realm, user)).toBe(true);
    expect(
      await service.canDeliver(realm, {
        ...(user as object),
        emailVerified: false,
      } as never),
    ).toBe(false);
    email.isConfigured.mockResolvedValue(false);
    expect(await service.canDeliver(realm, user)).toBe(false);
    await expect(send()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('stores only keyed hashes, and accepts the code once', async () => {
    const sent = await send();
    expect(sent.maskedEmail).toBe('J•••@Example.test');
    expect(sentCode).toMatch(/^\d{6}$/);
    const [row] = fake.rows;
    expect(JSON.stringify(row)).not.toContain(sentCode);
    expect(row.purpose).toBe('email_login');

    const ok = await service.verify({
      realmId: 'realm-1',
      userId: 'u1',
      binding: 'txn-1',
      code: sentCode,
    });
    expect(ok).toEqual({ ok: true });
    expect(fake.rows).toHaveLength(0);
    expect(
      await service.verify({
        realmId: 'realm-1',
        userId: 'u1',
        binding: 'txn-1',
        code: sentCode,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('is bound to the transaction and to the user', async () => {
    await send('txn-1');
    for (const wrong of [
      { binding: 'txn-2', userId: 'u1' },
      { binding: 'txn-1', userId: 'u2' },
    ]) {
      expect(
        await service.verify({ realmId: 'realm-1', code: sentCode, ...wrong }),
      ).toEqual({ ok: false, reason: 'not_found' });
    }
  });

  it('counts every guess before comparing, and locks after the budget', async () => {
    await send();
    const wrong = sentCode === '000000' ? '111111' : '000000';
    for (let i = 1; i < EMAIL_OTP_MAX_ATTEMPTS; i++) {
      expect(
        await service.verify({
          realmId: 'realm-1',
          userId: 'u1',
          binding: 'txn-1',
          code: wrong,
        }),
      ).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(
      await service.verify({
        realmId: 'realm-1',
        userId: 'u1',
        binding: 'txn-1',
        code: wrong,
      }),
    ).toEqual({ ok: false, reason: 'locked' });
    // Even the right code is refused once the budget is spent.
    expect(
      await service.verify({
        realmId: 'realm-1',
        userId: 'u1',
        binding: 'txn-1',
        code: sentCode,
      }),
    ).toEqual({ ok: false, reason: 'locked' });
  });

  it('refuses an expired code', async () => {
    const past = new Date(Date.now() - 10 * 60 * 1000);
    await send('txn-1', past);
    expect(
      await service.verify({
        realmId: 'realm-1',
        userId: 'u1',
        binding: 'txn-1',
        code: sentCode,
      }),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('enforces the resend cooldown, then replaces the code', async () => {
    const t0 = new Date();
    await send('txn-1', t0);
    const first = sentCode;
    await expect(
      send('txn-1', new Date(t0.getTime() + 5_000)),
    ).rejects.toBeInstanceOf(EmailOtpError);
    await send('txn-1', new Date(t0.getTime() + 31_000));
    expect(fake.rows[0].sendCount).toBe(2);
    if (first !== sentCode) {
      expect(
        await service.verify({
          realmId: 'realm-1',
          userId: 'u1',
          binding: 'txn-1',
          code: first,
        }),
      ).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('limits sends and wrong guesses per user across transactions', async () => {
    for (let i = 0; i < EMAIL_OTP_MAX_SENDS_PER_USER; i++) await send(`t${i}`);
    await expect(send('one-more')).rejects.toMatchObject({
      code: 'rate_limited',
    });

    fake.rows.length = 0;
    fake.rows.push({
      id: 'old',
      realmId: 'realm-1',
      userId: 'u1',
      purpose: 'email_login',
      bindingHash: 'x',
      attempts: EMAIL_OTP_MAX_FAILURES_PER_USER,
      sendCount: 1,
      lastSentAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(send('fresh')).rejects.toMatchObject({ code: 'locked' });
  });
});
