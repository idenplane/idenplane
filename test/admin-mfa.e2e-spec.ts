import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { createTestApp, TEST_ADMIN_API_KEY, type TestContext } from './setup';
import { CryptoService } from '../src/crypto/crypto.service';
import { SoftAuthenticator } from './helpers/soft-authenticator';
import { AdminAuthService } from '../src/admin-auth/admin-auth.service';
import { ACR_MFA } from '../src/authn-core/acr';

/**
 * Admin console MFA (docs/docs/security/admin-mfa.md): enrolment, the
 * second sign-in step, brute force, recovery codes, step-up, the
 * server-wide requirement and the API-key break-glass reset.
 *
 * Each admin is a fresh master realm user. A TOTP code is good once, so
 * each admin's codes come from distinct 30-second steps (-1, 0, +1).
 */
describe('Admin console MFA (e2e)', () => {
  let ctx: TestContext;
  const PREFIX = 'amfa-e2e-';
  const PASSWORD = 'AdminMfa-E2E-dummy-Pa55word!';
  const ids: Record<string, string> = {};
  let savedEnv: string | undefined;

  /** Alice's authenticator and her current recovery codes. */
  const alice = {
    totp: undefined as unknown as OTPAuth.TOTP,
    codes: [] as string[],
  };

  const http = () => request(ctx.app.getHttpServer());
  const bearer = (token: string): [string, string] => [
    'authorization',
    `Bearer ${token}`,
  ];
  const apiKey: [string, string] = ['x-admin-api-key', TEST_ADMIN_API_KEY];

  const claims = (token: string) =>
    JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

  /** A TOTP code `steps` periods from now (-1, 0 and +1 are accepted). */
  const codeAt = (totp: OTPAuth.TOTP, steps: number) =>
    totp.generate({ timestamp: Date.now() + steps * 30_000 });

  /** The codes this file has already sent, per authenticator. */
  const sentCodes = new Map<OTPAuth.TOTP, Set<string>>();

  /**
   * A code the server accepts now and has not been sent yet (a code works
   * once). The server checks the code a moment after it is generated, and
   * accepts the steps -1, 0 and +1 of its own clock. A code for step 0 or +1
   * therefore survives the clock moving into the next step in between; a
   * code for step -1 does not, so it is only used with time left in the
   * step. With no unused code left, this waits for the next step.
   */
  const freshCode = async (totp: OTPAuth.TOTP): Promise<string> => {
    const sent = sentCodes.get(totp) ?? new Set<string>();
    sentCodes.set(totp, sent);
    for (;;) {
      const leftInStep = 30_000 - (Date.now() % 30_000);
      for (const step of leftInStep > 5_000 ? [0, 1, -1] : [0, 1]) {
        const code = codeAt(totp, step);
        if (!sent.has(code)) {
          sent.add(code);
          return code;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, leftInStep + 50));
    }
  };

  /** A six-digit code that is valid in no step near now. */
  const wrongCode = (totp: OTPAuth.TOTP) => {
    const valid = new Set([-2, -1, 0, 1, 2].map((s) => codeAt(totp, s)));
    for (let n = 0; ; n++) {
      const candidate = String(n).padStart(6, '0');
      if (!valid.has(candidate)) return candidate;
    }
  };

  const login = (who: string) =>
    http()
      .post('/admin/auth/login')
      .send({ username: `${PREFIX}${who}`, password: PASSWORD });

  /** Both sign-in steps with a code: the token. */
  const signIn = async (
    who: string,
    method: 'totp' | 'recovery',
    code: string,
  ) => {
    const first = await login(who).expect(200);
    expect(first.body.mfa_required).toBe(true);
    const res = await http()
      .post('/admin/auth/login/mfa')
      .send({ mfa_token: first.body.mfa_token, method, code })
      .expect(200);
    return res.body.access_token as string;
  };

  const setPolicy = (required: boolean) =>
    ctx.prisma.adminSecurityPolicy.upsert({
      where: { id: 1 },
      create: { id: 1, mfaRequired: required },
      update: { mfaRequired: required },
    });

  /** Signs in with a password only (no factor yet): the token. */
  const passwordToken = async (who: string) => {
    const res = await login(who).expect(200);
    expect(res.body.access_token).toEqual(expect.any(String));
    return res.body.access_token as string;
  };

  /** Enrols TOTP with `token`; the authenticator, codes and new token. */
  const enrolTotp = async (token: string) => {
    const setup = await http()
      .post('/admin/auth/mfa/totp')
      .set(...bearer(token))
      .expect(200);
    expect(setup.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(setup.body.secret as string),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const activated = await http()
      .post('/admin/auth/mfa/totp/activate')
      .set(...bearer(token))
      .send({ code: await freshCode(totp) })
      .expect(200);
    return {
      totp,
      recoveryCodes: activated.body.recoveryCodes as string[],
      token: activated.body.access_token as string,
    };
  };

  const masterId = async () =>
    (await ctx.prisma.realm.findUniqueOrThrow({ where: { name: 'master' } }))
      .id;

  const dropChallenges = () =>
    ctx.prisma.pendingAction.deleteMany({
      where: { type: 'admin_mfa_challenge' },
    });

  const cleanup = async () => {
    const master = await ctx.prisma.realm.findUnique({
      where: { name: 'master' },
    });
    if (master) {
      await ctx.prisma.user.deleteMany({
        where: { realmId: master.id, username: { startsWith: PREFIX } },
      });
    }
    await dropChallenges();
  };

  beforeAll(async () => {
    // e2e-env.ts fixes ADMIN_MFA_REQUIRED=false for the other suites; here
    // the stored setting decides.
    savedEnv = process.env['ADMIN_MFA_REQUIRED'];
    delete process.env['ADMIN_MFA_REQUIRED'];

    ctx = await createTestApp();
    await cleanup();
    await setPolicy(false);

    const master = await ctx.prisma.realm.findUniqueOrThrow({
      where: { name: 'master' },
      include: { roles: true },
    });
    const roleId = (name: string) => {
      const role = master.roles.find((r) => r.name === name && !r.clientId);
      if (!role) throw new Error(`master realm has no ${name} role`);
      return role.id;
    };
    const passwordHash = await ctx.app
      .get(CryptoService)
      .hashPassword(PASSWORD);
    for (const [who, roleName] of [
      ['alice', 'super-admin'],
      ['bob', 'super-admin'],
      ['carol', 'realm-admin'],
      ['dave', 'view-only'],
      ['erin', 'super-admin'],
    ] as const) {
      const user = await ctx.prisma.user.create({
        data: {
          realmId: master.id,
          username: `${PREFIX}${who}`,
          enabled: true,
          passwordHash,
          userRoles: { create: { roleId: roleId(roleName) } },
        },
      });
      ids[who] = user.id;
    }
  }, 60_000);

  // A sign-in may create at most five challenges per admin in 5 minutes.
  beforeEach(() => dropChallenges());

  afterAll(async () => {
    await cleanup();
    await setPolicy(false);
    if (savedEnv === undefined) delete process.env['ADMIN_MFA_REQUIRED'];
    else process.env['ADMIN_MFA_REQUIRED'] = savedEnv;
    await ctx.cleanup();
  });

  // ── alice: TOTP, sign-in, replay, recovery codes, step-up ─────────────

  describe('enrolment and sign-in', () => {
    it('signs in with a password only until a factor is enrolled', async () => {
      const res = await login('alice').expect(200);
      expect(res.body.mfa_required).toBeUndefined();
      expect(res.body.mfa_enrolment_required).toBeUndefined();
      expect(claims(res.body.access_token)).toMatchObject({
        typ: 'admin',
        amr: ['pwd'],
        acr: 'urn:idenplane:acr:password',
        auth_time: expect.any(Number),
      });
      const status = await http()
        .get('/admin/auth/mfa')
        .set(...bearer(res.body.access_token))
        .expect(200);
      expect(status.body).toMatchObject({
        enrolled: false,
        totp: false,
        passkeys: [],
        policy: { required: false, source: 'setting' },
      });
    });

    it('enrols TOTP, shows the recovery codes once and upgrades the session', async () => {
      const before = await passwordToken('alice');
      const enrolled = await enrolTotp(before);
      alice.totp = enrolled.totp;
      alice.codes = enrolled.recoveryCodes;

      expect(alice.codes).toHaveLength(10);
      for (const code of alice.codes) {
        expect(code).toMatch(/^[a-z2-7]{6}(-[a-z2-7]{6}){3}$/);
      }
      expect(claims(enrolled.token)).toMatchObject({
        amr: ['pwd', 'otp', 'mfa'],
        acr: 'urn:idenplane:acr:mfa',
      });
      // The password-only token it replaced is revoked.
      await http()
        .get('/admin/auth/me')
        .set(...bearer(before))
        .expect(401);
      const me = await http()
        .get('/admin/auth/me')
        .set(...bearer(enrolled.token))
        .expect(200);
      expect(me.body.mfa).toMatchObject({ enrolled: true, verified: true });

      const event = await ctx.prisma.adminEvent.findFirst({
        where: {
          realmId: await masterId(),
          resourceType: 'ADMIN_MFA',
          adminUserId: ids['alice'],
        },
      });
      expect(event?.representation).toEqual({
        action: 'enrol-totp',
        userId: ids['alice'],
      });
    });

    it('then asks for the second factor at sign-in, with no token or cookie', async () => {
      const res = await login('alice').expect(200);
      expect(res.body).toEqual({
        mfa_required: true,
        mfa_token: expect.any(String),
        methods: ['totp', 'recovery'],
      });
      expect(String(res.headers['set-cookie'] ?? '')).not.toContain(
        'admin_rt=',
      );
    });

    it('refuses a wrong code, counting it against brute force', async () => {
      const first = await login('alice').expect(200);
      await http()
        .post('/admin/auth/login/mfa')
        .send({
          mfa_token: first.body.mfa_token,
          method: 'totp',
          code: wrongCode(alice.totp),
        })
        .expect(401);
      expect(
        await ctx.prisma.totpFailureTracking.count({
          where: { userId: ids['alice'] },
        }),
      ).toBe(1);
      expect(
        await ctx.prisma.loginEvent.count({
          where: { userId: ids['alice'], type: 'MFA_VERIFY_ERROR' },
        }),
      ).toBe(1);
    });

    it('signs in with the code, with MFA claims, and only once per code', async () => {
      const code = await freshCode(alice.totp);
      const first = await login('alice').expect(200);
      const res = await http()
        .post('/admin/auth/login/mfa')
        .send({ mfa_token: first.body.mfa_token, method: 'totp', code })
        .expect(200);
      expect(claims(res.body.access_token)).toMatchObject({
        typ: 'admin',
        amr: ['pwd', 'otp', 'mfa'],
        acr: 'urn:idenplane:acr:mfa',
      });
      expect(String(res.headers['set-cookie'])).toContain('admin_rt=');
      // The success cleared the failure counter.
      expect(
        await ctx.prisma.totpFailureTracking.count({
          where: { userId: ids['alice'] },
        }),
      ).toBe(0);
      // The challenge is spent.
      await http()
        .post('/admin/auth/login/mfa')
        .send({ mfa_token: first.body.mfa_token, method: 'totp', code })
        .expect(401);
      // The same code on a new sign-in is a replay.
      const second = await login('alice').expect(200);
      await http()
        .post('/admin/auth/login/mfa')
        .send({ mfa_token: second.body.mfa_token, method: 'totp', code })
        .expect(401);
      await ctx.prisma.totpFailureTracking.deleteMany({
        where: { userId: ids['alice'] },
      });
    });

    it('accepts a recovery code once', async () => {
      const code = alice.codes[0];
      const token = await signIn(
        'alice',
        'recovery',
        code.toUpperCase().replace(/-/g, ' '),
      );
      expect(claims(token)).toMatchObject({
        amr: ['pwd', 'mfa'],
        acr: 'urn:idenplane:acr:mfa',
      });
      const again = await login('alice').expect(200);
      await http()
        .post('/admin/auth/login/mfa')
        .send({ mfa_token: again.body.mfa_token, method: 'recovery', code })
        .expect(401);
      const status = await http()
        .get('/admin/auth/mfa')
        .set(...bearer(token))
        .expect(200);
      expect(status.body.recoveryCodes).toEqual({
        remaining: 9,
        oldFormat: false,
      });
    });

    it('gives each sign-in five answers at most', async () => {
      const first = await login('alice').expect(200);
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/admin/auth/login/mfa')
          .send({
            mfa_token: first.body.mfa_token,
            method: 'recovery',
            code: `wrong-${i}`,
          })
          .expect(401);
      }
      // Even the right answer is refused now.
      await http()
        .post('/admin/auth/login/mfa')
        .send({
          mfa_token: first.body.mfa_token,
          method: 'recovery',
          code: alice.codes[1],
        })
        .expect(401);
      await ctx.prisma.totpFailureTracking.deleteMany({
        where: { userId: ids['alice'] },
      });
    });

    it('steps up for a sensitive action and replaces the token', async () => {
      const token = await signIn('alice', 'recovery', alice.codes[2]);
      // Fifteen minutes on, the sign-in is no longer a recent check.
      const realDateNow = Date.now;
      Date.now = () => realDateNow() + 16 * 60_000;
      try {
        const refused = await http()
          .post('/admin/auth/mfa/recovery-codes')
          .set(...bearer(token))
          .expect(403);
        expect(refused.body.code).toBe('admin_recent_mfa_required');
        const stepped = await http()
          .post('/admin/auth/step-up')
          .set(...bearer(token))
          .send({ method: 'totp', code: await freshCode(alice.totp) })
          .expect(200);
        const renewed = await http()
          .post('/admin/auth/mfa/recovery-codes')
          .set(...bearer(stepped.body.access_token))
          .expect(200);
        expect(renewed.body.recoveryCodes).toHaveLength(10);
        alice.codes = renewed.body.recoveryCodes as string[];
        // The token the step-up replaced is revoked.
        await http()
          .get('/admin/auth/me')
          .set(...bearer(token))
          .expect(401);
      } finally {
        Date.now = realDateNow;
      }
    });
  });

  // ── carol: brute force, unlock, API-key reset ──────────────────────────

  describe('brute force and break-glass', () => {
    let totp: OTPAuth.TOTP;

    beforeAll(async () => {
      ({ totp } = await enrolTotp(await passwordToken('carol')));
    });

    it('locks the account after the realm limit of wrong codes', async () => {
      const master = await ctx.prisma.realm.findUniqueOrThrow({
        where: { name: 'master' },
      });
      const wrong = wrongCode(totp);
      let answered = 0;
      while (answered < master.maxLoginFailures) {
        const first = await login('carol').expect(200);
        for (let i = 0; i < 5 && answered < master.maxLoginFailures; i++) {
          await http()
            .post('/admin/auth/login/mfa')
            .send({
              mfa_token: first.body.mfa_token,
              method: 'totp',
              code: wrong,
            })
            .expect(401);
          answered++;
        }
        await dropChallenges();
      }
      const carol = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: ids['carol'] },
      });
      expect(carol.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
      // The password step is refused while locked.
      await login('carol').expect(429);
    });

    it('unlocks with a recent admin MFA check, still not with the API key', async () => {
      const unlockPath = `/admin/realms/master/brute-force/users/${ids['carol']}/unlock`;
      await http()
        .post(unlockPath)
        .set(...apiKey)
        .expect(401);
      const erin = await passwordToken('erin');
      await http()
        .post(unlockPath)
        .set(...bearer(erin))
        .expect(401);

      const token = await signIn('alice', 'recovery', alice.codes[0]);
      await http()
        .post(unlockPath)
        .set(...bearer(token))
        .expect(200);
      const carol = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: ids['carol'] },
      });
      expect(carol.lockedUntil).toBeNull();
    });

    it('lets the admin API key reset an admin, always recorded', async () => {
      const master = await masterId();
      // A console token carol holds from before the reset.
      const { access_token: before } = await ctx.app
        .get(AdminAuthService)
        .issueAdminToken(
          { id: ids['carol'], username: `${PREFIX}carol` },
          ['realm-admin'],
          { amr: ['pwd', 'otp', 'mfa'], acr: ACR_MFA },
        );
      await http()
        .get('/admin/auth/me')
        .set(...bearer(before))
        .expect(200);
      // Recorded even with admin events off in master.
      await ctx.prisma.realm.update({
        where: { id: master },
        data: { adminEventsEnabled: false },
      });
      try {
        await http()
          .delete(`/admin/admin-accounts/${ids['carol']}/mfa`)
          .set(...apiKey)
          .expect(204);
      } finally {
        await ctx.prisma.realm.update({
          where: { id: master },
          data: { adminEventsEnabled: true },
        });
      }
      expect(
        await ctx.prisma.userCredential.count({
          where: { userId: ids['carol'] },
        }),
      ).toBe(0);
      expect(
        await ctx.prisma.recoveryCode.count({
          where: { userId: ids['carol'] },
        }),
      ).toBe(0);
      const event = await ctx.prisma.adminEvent.findFirst({
        where: {
          realmId: master,
          resourceType: 'ADMIN_MFA',
          resourcePath: `admin-accounts/${ids['carol']}/mfa`,
        },
      });
      expect(event).toMatchObject({
        adminUserId: 'api-key:admin',
        operationType: 'DELETE',
        representation: expect.objectContaining({
          action: 'reset-mfa',
          by: 'api-key',
        }),
      });
      // The reset signed carol out of the console: her old token is refused.
      await http()
        .get('/admin/auth/me')
        .set(...bearer(before))
        .expect(401);
      // Carol signs in with the password alone again.
      const res = await login('carol').expect(200);
      expect(res.body.access_token).toEqual(expect.any(String));
      await http()
        .get('/admin/auth/me')
        .set(...bearer(res.body.access_token as string))
        .expect(200);
    });

    it('lists every admin with their factors for a super-admin', async () => {
      const list = await http()
        .get('/admin/admin-accounts')
        .set(...apiKey)
        .expect(200);
      const byName = (who: string) =>
        (list.body as Array<{ username: string; mfa: object }>).find(
          (a) => a.username === `${PREFIX}${who}`,
        );
      expect(byName('alice')?.mfa).toMatchObject({
        enrolled: true,
        totp: true,
        passkeys: 0,
        oldFormatRecoveryCodes: false,
      });
      expect(byName('carol')?.mfa).toMatchObject({ enrolled: false });
    });

    it('asks a super-admin for their own recent MFA before a reset', async () => {
      const erin = await passwordToken('erin');
      const refused = await http()
        .delete(`/admin/admin-accounts/${ids['alice']}/mfa`)
        .set(...bearer(erin))
        .expect(403);
      expect(refused.body.code).toBe('admin_recent_mfa_required');
      // A view-only admin is refused by role, before any MFA question.
      const dave = await passwordToken('dave');
      const byRole = await http()
        .delete(`/admin/admin-accounts/${ids['alice']}/mfa`)
        .set(...bearer(dave))
        .expect(403);
      expect(byRole.body.code).toBeUndefined();
    });
  });

  // ── dave: passkeys ─────────────────────────────────────────────────────

  describe('passkeys', () => {
    const base = new URL(process.env['BASE_URL'] ?? 'http://localhost:3000');
    const authenticator = new SoftAuthenticator(base.hostname, base.origin);

    it('registers a passkey as the first factor and signs in with it', async () => {
      const token = await passwordToken('dave');
      const options = await http()
        .post('/admin/auth/mfa/passkeys/options')
        .set(...bearer(token))
        .expect(200);
      expect(options.body.rp.id).toBe(base.hostname);
      const registered = await http()
        .post('/admin/auth/mfa/passkeys')
        .set(...bearer(token))
        .send({
          response: authenticator.register(options.body),
          name: 'Soft key',
        })
        .expect(200);
      expect(registered.body.recoveryCodes).toHaveLength(10);
      expect(registered.body.passkey.name).toBe('Soft key');
      expect(claims(registered.body.access_token)).toMatchObject({
        amr: ['pwd', 'hwk', 'mfa'],
        acr: 'urn:idenplane:acr:webauthn',
      });

      const first = await login('dave').expect(200);
      expect(first.body.methods).toEqual(['passkey', 'recovery']);
      const options2 = await http()
        .post('/admin/auth/login/passkey/options')
        .send({ mfa_token: first.body.mfa_token })
        .expect(200);
      const res = await http()
        .post('/admin/auth/login/passkey')
        .send({
          mfa_token: first.body.mfa_token,
          response: authenticator.assert(options2.body),
        })
        .expect(200);
      expect(claims(res.body.access_token)).toMatchObject({
        acr: 'urn:idenplane:acr:webauthn',
      });
    });

    it('refuses a passkey that is not this admin’s', async () => {
      const first = await login('dave').expect(200);
      const options = await http()
        .post('/admin/auth/login/passkey/options')
        .send({ mfa_token: first.body.mfa_token })
        .expect(200);
      const stranger = new SoftAuthenticator(base.hostname, base.origin);
      await http()
        .post('/admin/auth/login/passkey')
        .send({
          mfa_token: first.body.mfa_token,
          response: stranger.assert(options.body),
        })
        .expect(401);
    });
  });

  // ── bob: the server-wide requirement ───────────────────────────────────

  describe('MFA required for every admin', () => {
    let bobTotp: OTPAuth.TOTP;

    afterAll(async () => {
      await setPolicy(false);
      delete process.env['ADMIN_MFA_REQUIRED'];
    });

    it('is changed by a super-admin and recorded', async () => {
      const res = await http()
        .put('/admin/admin-mfa/policy')
        .set(...apiKey)
        .send({ required: true })
        .expect(200);
      expect(res.body).toEqual({ required: true, source: 'setting' });
      const event = await ctx.prisma.adminEvent.findFirst({
        where: { resourceType: 'ADMIN_MFA', resourcePath: 'admin-mfa/policy' },
        orderBy: { createdAt: 'desc' },
      });
      expect(event?.representation).toMatchObject({
        action: 'set-requirement',
        required: true,
      });
    });

    it('confines an unenrolled admin to enrolment until a factor is set up', async () => {
      // A session from before enrolment, kept for the step-up check below.
      const res = await login('bob').expect(200);
      expect(res.body.mfa_enrolment_required).toBe(true);
      const token = res.body.access_token as string;

      const refused = await http()
        .get('/admin/realms')
        .set(...bearer(token))
        .expect(403);
      expect(refused.body).toMatchObject({
        code: 'admin_mfa_enrolment_required',
      });
      await http()
        .get('/admin/admin-accounts')
        .set(...bearer(token))
        .expect(403);
      await http()
        .get('/admin/auth/me')
        .set(...bearer(token))
        .expect(200);
      await http()
        .get('/admin/auth/mfa')
        .set(...bearer(token))
        .expect(200);

      const second = await passwordToken('bob');
      const enrolled = await enrolTotp(second);
      bobTotp = enrolled.totp;
      await http()
        .get('/admin/realms')
        .set(...bearer(enrolled.token))
        .expect(200);

      // The first password-only session now has to step up.
      const stale = await http()
        .get('/admin/realms')
        .set(...bearer(token))
        .expect(403);
      expect(stale.body.code).toBe('admin_mfa_step_up_required');
      const stepped = await http()
        .post('/admin/auth/step-up')
        .set(...bearer(token))
        .send({ method: 'totp', code: await freshCode(bobTotp) })
        .expect(200);
      await http()
        .get('/admin/realms')
        .set(...bearer(stepped.body.access_token))
        .expect(200);
    });

    it('refuses to remove the last factor while it is required', async () => {
      const token = await signIn('bob', 'totp', await freshCode(bobTotp));
      await http()
        .delete('/admin/auth/mfa/totp')
        .set(...bearer(token))
        .expect(409);
    });

    it('applies to the next request, not the next sign-in', async () => {
      await setPolicy(false);
      const token = await passwordToken('erin');
      await http()
        .get('/admin/realms')
        .set(...bearer(token))
        .expect(200);
      await setPolicy(true);
      const refused = await http()
        .get('/admin/realms')
        .set(...bearer(token))
        .expect(403);
      expect(refused.body.code).toBe('admin_mfa_enrolment_required');
    });

    it('never confines the admin API key', async () => {
      await http()
        .get('/admin/realms')
        .set(...apiKey)
        .expect(200);
    });

    it('can be fixed by ADMIN_MFA_REQUIRED, which the console cannot change', async () => {
      process.env['ADMIN_MFA_REQUIRED'] = 'false';
      const token = await passwordToken('erin');
      await http()
        .get('/admin/realms')
        .set(...bearer(token))
        .expect(200);
      process.env['ADMIN_MFA_REQUIRED'] = 'true';
      await http()
        .put('/admin/admin-mfa/policy')
        .set(...apiKey)
        .send({ required: false })
        .expect(409);
      const policy = await http()
        .get('/admin/admin-mfa/policy')
        .set(...apiKey)
        .expect(200);
      expect(policy.body).toEqual({ required: true, source: 'environment' });
    });
  });
});
