import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'pg';
import { createTlsFixture } from './session-tls-fixture.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { chromium } from '../../../admin-ui/node_modules/@playwright/test/index.mjs';
const root = path.resolve(__dirname, '../../..'),
  dir = path.resolve(
    process.env.SESSION_TEST_ARTIFACTS ||
      path.join(tmpdir(), 'idenplane-session-evidence'),
  ),
  backendImage = process.env.IDENPLANE_TEST_IMAGE || 'idenplane:session-ci',
  tag = 'server-session-' + Date.now().toString(36),
  context = dir + '/build-' + tag,
  checks = [];
fs.mkdirSync(dir, { recursive: true });
const httpsMode = process.env.SESSION_TEST_HTTPS === 'true';
let fetch = globalThis.fetch,
  tlsFixture;
let browser,
  fixture,
  cleanup = false,
  failed = true,
  rootPool,
  sessionPool;
const names = [tag + '-web', tag + '-app', tag + '-db'];
const run = (args, opts = {}) =>
  cp.spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
  });
const docker = (args, opts) => {
  const r = run(args, opts);
  if (r.status !== 0)
    throw Error(
      'Docker ' +
        args.slice(0, 2).join(' ') +
        ' failed: ' +
        (r.stderr || '').slice(-1200),
    );
  return r.stdout.trim();
};
const record = (name) => checks.push({ name, passed: true });
/** Keeps every container's recent output next to the results of a failed run. */
const saveContainerLogs = () => {
  const listed = run([
    'ps',
    '-a',
    '--filter',
    'label=idenplane.validation=' + tag,
    '--format',
    '{{.Names}}',
  ]);
  for (const name of listed.stdout.split('\n').filter(Boolean)) {
    const logs = run(['logs', '--tail', '300', name]);
    fs.writeFileSync(
      dir + '/container-' + name + '.log',
      (logs.stdout + logs.stderr).replace(
        /id_token_hint=[^&\s"\\]+/g,
        'id_token_hint=REDACTED',
      ),
    );
  }
};
const save = (error) =>
  fs.writeFileSync(
    dir + '/runtime-results.json',
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        checks,
        success: !error,
        cleanup,
        error,
        backendImage: backendImage,
        sdkSource:
          'working tree, injected built dist; not published registry version',
        cloudComputeUsed: false,
        httpsMode,
        browserTrust: httpsMode
          ? 'fixture-key SPKI exception; no global trust store change'
          : 'HTTP loopback development exception',
        serverCertificateVerification: httpsMode
          ? 'private fixture CA and hostname verified; unknown CA and wrong hostname rejected'
          : 'not applicable',
      },
      null,
      2,
    ),
  );
async function port() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function ready(url) {
  for (let n = 0; n < 120; n++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('Readiness timeout ' + url);
}
(async () => {
  try {
    const [appPort, webPort, dbPort, secondPort] = [
        await port(),
        await port(),
        await port(),
        await port(),
      ],
      tlsPorts = httpsMode
        ? {
            idp: await port(),
            web: await port(),
            replica: await port(),
            plain: await port(),
          }
        : undefined;
    if (httpsMode) {
      tlsFixture = createTlsFixture({
        docker,
        run,
        backendImage,
        tag,
        ports: tlsPorts,
      });
      fetch = tlsFixture.fetch;
    }
    const base = tlsFixture?.base ?? 'http://localhost:' + appPort,
      web = tlsFixture?.web ?? 'http://localhost:' + webPort;
    fs.mkdirSync(context, { recursive: true });
    const example = root + '/examples/nextjs-quickstart';
    const files = cp
      .spawnSync(
        'git',
        [
          'ls-files',
          '--cached',
          '--others',
          '--exclude-standard',
          '-z',
          '--',
          'examples/nextjs-quickstart',
        ],
        { cwd: root, encoding: 'utf8', windowsHide: true },
      )
      .stdout.split('\0')
      .filter(Boolean);
    for (const file of files) {
      const relative = file.replace('examples/nextjs-quickstart/', '');
      if (/(^|\/)\.env(?:\..*)?$/.test(relative)) continue;
      const dst = path.join(context, relative);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(root + '/' + file, dst);
    }
    fs.cpSync(root + '/packages/idenplane-js/dist', context + '/sdk-dist', {
      recursive: true,
    });
    let dockerfile = fs.readFileSync(example + '/Dockerfile', 'utf8');
    dockerfile = dockerfile.replace(
      'RUN npm run build',
      `COPY sdk-dist /app/node_modules/idenplane-sdk/dist\nENV NEXT_PUBLIC_IDENPLANE_SERVER_URL=${base}\nENV NEXT_PUBLIC_IDENPLANE_REDIRECT_URI=${web}/callback\nRUN npm run build`,
    );
    fs.writeFileSync(context + '/Dockerfile', dockerfile);
    const built = run(['build', '-t', 'idenplane-nextjs:' + tag, context], {
      timeout: 600000,
    });
    fs.writeFileSync(dir + '/nextjs-build.log', built.stdout + built.stderr);
    assert.equal(built.status, 0, 'Next.js build failed');
    record('nextjs_production_build_with_modified_sdk');
    docker([
      'network',
      'create',
      '--label',
      'idenplane.validation=' + tag,
      tag,
    ]);
    tlsFixture?.start();
    const pg = crypto.randomBytes(24).toString('hex'),
      admin = crypto.randomBytes(32).toString('hex');
    docker([
      'run',
      '-d',
      '--name',
      names[2],
      '--label',
      'idenplane.validation=' + tag,
      '--network',
      tag,
      '-e',
      'POSTGRES_USER=idenplane',
      '-e',
      'POSTGRES_DB=idenplane',
      '-e',
      'POSTGRES_PASSWORD=' + pg,
      '-p',
      `127.0.0.1:${dbPort}:5432`,
      'postgres:16-alpine',
    ]);
    for (let n = 0; n < 50; n++) {
      if (
        run([
          'exec',
          names[2],
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'idenplane',
        ]).status === 0
      )
        break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const env = {
      DATABASE_URL: `postgresql://idenplane:${pg}@${names[2]}:5432/idenplane`,
      NODE_ENV: 'production',
      BASE_URL: base,
      PORT: '3000',
      ADMIN_USER: 'admin',
      ADMIN_PASSWORD: crypto.randomBytes(24).toString('hex'),
      ADMIN_API_KEY: admin,
      WEBHOOK_SECRET_KEY: crypto.randomBytes(32).toString('hex'),
      WEBHOOK_ENCRYPTION_SALT: crypto.randomBytes(16).toString('hex'),
    };
    const args = [
      'run',
      '-d',
      '--name',
      names[1],
      '--label',
      'idenplane.validation=' + tag,
      '--network',
      tag,
      '-p',
      `127.0.0.1:${appPort}:3000`,
    ];
    for (const [key, value] of Object.entries(env))
      args.push('-e', key + '=' + value);
    docker([...args, backendImage]);
    await ready(base + '/health/ready');
    if (tlsFixture) {
      await tlsFixture.verifyTrust();
      record('https_provider_ca_and_hostname_verified_with_negative_controls');
    }
    record('isolated_backend_and_fresh_database_ready');
    async function adminPost(url, data) {
      const r = await fetch(base + url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-api-key': admin,
        },
        body: JSON.stringify(data),
      });
      assert.ok(r.ok, url + ' ' + r.status);
      return r.json();
    }
    await adminPost('/admin/realms', {
      name: 'quickstart',
      accessTokenLifespan: 60,
    });
    const alice = await adminPost('/admin/realms/quickstart/users', {
      username: 'demo',
      email: 'demo@example.com',
      firstName: 'Demo',
      lastName: 'User',
      password: 'Demo1234!',
      enabled: true,
    });
    const bob = await adminPost('/admin/realms/quickstart/users', {
      username: 'other',
      email: 'other@example.com',
      firstName: 'Other',
      lastName: 'User',
      password: 'OtherDemo1234!',
      enabled: true,
    });
    await adminPost('/admin/realms/quickstart/clients', {
      clientId: 'nextjs-quickstart',
      clientType: 'PUBLIC',
      redirectUris: [web + '/callback'],
      postLogoutRedirectUris: [web],
      webOrigins: [web],
      grantTypes: ['authorization_code', 'refresh_token'],
    });
    const { Pool } = postgres;
    rootPool = new Pool({
      host: '127.0.0.1',
      port: dbPort,
      user: 'idenplane',
      database: 'idenplane',
      password: pg,
      max: 2,
    });
    rootPool.on('error', () => {});
    const { createServerSessionEnvironment } = await import(
      pathToFileURL(path.join(example, 'scripts/setup-server-session.mjs')).href
    );
    const bootstrapDirectory = fs.mkdtempSync(dir + '/bootstrap-');
    let bootstrapFile, bootstrap;
    try {
      bootstrapFile = await createServerSessionEnvironment({
        directory: bootstrapDirectory,
        localDemo: !httpsMode,
        fetcher: fetch,
        appOrigin: web,
        serverOrigin: base,
        adminKey: admin,
      });
      bootstrap = Object.fromEntries(
        fs
          .readFileSync(bootstrapFile, 'utf8')
          .split(/\r?\n/)
          .filter((l) => l && !l.startsWith('#'))
          .map((l) => {
            const n = l.indexOf('=');
            return [l.slice(0, n), l.slice(n + 1)];
          }),
      );
    } finally {
      if (bootstrapFile && fs.existsSync(bootstrapFile))
        fs.unlinkSync(bootstrapFile);
      fs.rmdirSync(bootstrapDirectory);
    }
    const sessionPassword = bootstrap.SESSION_POSTGRES_PASSWORD,
      sessionKey = bootstrap.SESSION_ENCRYPTION_KEY;
    record(
      'real_bootstrap_registers_confidential_client_and_generates_private_secrets',
    );
    await rootPool.query(
      "CREATE ROLE bff LOGIN PASSWORD '" + sessionPassword + "'",
    );
    await rootPool.query('CREATE DATABASE bff OWNER bff');
    sessionPool = new Pool({
      host: '127.0.0.1',
      port: dbPort,
      user: 'bff',
      database: 'bff',
      password: sessionPassword,
      max: 3,
    });
    sessionPool.on('error', () => {});
    await sessionPool.query(
      fs.readFileSync(
        root + '/examples/nextjs-quickstart/session-schema.sql',
        'utf8',
      ),
    );
    const confidential = { clientSecret: bootstrap.SESSION_CLIENT_SECRET };
    assert.ok(confidential.clientSecret);
    const sessionEnv = {
      IDENPLANE_INTERNAL_URL: 'http://' + names[1] + ':3000',
      SESSION_APP_ORIGIN: web,
      SESSION_DATABASE_URL: `postgresql://bff:${sessionPassword}@${names[2]}:5432/bff`,
      SESSION_ENCRYPTION_KEY: sessionKey,
      SESSION_CLIENT_ID: 'nextjs-session',
      SESSION_CLIENT_SECRET: confidential.clientSecret,
      SESSION_ALLOW_INSECURE_LOCALHOST: 'true',
      ...tlsFixture?.containerEnvironment,
    };
    function startWeb(name, portNumber) {
      const args = [
        'run',
        '-d',
        '--name',
        name,
        '--label',
        'idenplane.validation=' + tag,
        '--network',
        tag,
        '-p',
        `127.0.0.1:${portNumber}:3001`,
      ];
      for (const [key, value] of Object.entries(sessionEnv))
        args.push('-e', key + '=' + value);
      if (tlsFixture) args.push(...tlsFixture.containerArgs);
      docker([...args, 'idenplane-nextjs:' + tag]);
    }
    names.push(tag + '-replica');
    startWeb(names[0], webPort);
    startWeb(names[3], secondPort);
    const replica = tlsFixture?.replica ?? 'http://localhost:' + secondPort;
    await Promise.all([
      ready(web + '/server-session'),
      ready(replica + '/server-session'),
    ]);
    record('two_independent_nextjs_workers_ready');
    browser = await chromium.launch({
      headless: true,
      args: tlsFixture?.browserArgs,
    });
    const ctx = await browser.newContext(),
      page = await ctx.newPage(),
      errors = [],
      browserTokenRequests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (r.url().endsWith('/token')) browserTokenRequests.push(r.url());
    });
    const cookieName = httpsMode
      ? '__Host-idenplane_session'
      : 'idenplane_session_dev';
    async function cookies(context) {
      return (await context.cookies(web)).find((c) => c.name === cookieName);
    }
    async function api(origin, cookie, options = {}) {
      return fetch(origin + '/api/session/' + (options.path ?? 'profile'), {
        method: options.method ?? 'GET',
        headers: {
          ...(cookie ? { cookie: cookieName + '=' + cookie } : {}),
          ...options.headers,
        },
        redirect: 'manual',
      });
    }
    async function attemptLogin(page, username, password) {
      const failedRequests = [];
      const onFailed = (request) =>
        failedRequests.push(
          request.url().split('?')[0] + ' ' + request.failure()?.errorText,
        );
      page.on('requestfailed', onFailed);
      await page.goto(web + '/server-session');
      await page
        .getByRole('button', { name: 'Sign in securely', exact: true })
        .click();
      await page.locator('input[name="username"]').fill(username);
      await page.locator('input[name="password"]').fill(password);
      await page.locator('button[type="submit"]').first().click();
      // The first sign-in crosses the provider, the TLS proxy and a cold
      // Next.js worker; shared CI runners sometimes need more than 30 s.
      try {
        await page
          .getByRole('heading', { name: 'Signed in securely' })
          .waitFor({ timeout: 90000 });
      } catch (error) {
        throw new Error(
          'Sign-in did not finish; the browser stopped at ' +
            page.url() +
            (failedRequests.length
              ? '; failed requests: ' + failedRequests.join(', ')
              : ''),
          { cause: error },
        );
      } finally {
        page.off('requestfailed', onFailed);
      }
    }
    // Chromium aborts in-flight requests with ERR_NETWORK_CHANGED when the
    // host's interfaces change, which Docker does on shared CI runners while
    // containers start. That says nothing about Idenplane, so such a sign-in
    // is started once more; any other failure fails the check.
    async function login(page, username, password) {
      try {
        await attemptLogin(page, username, password);
      } catch (error) {
        if (!String(error.message).includes('ERR_NETWORK_CHANGED')) throw error;
        await attemptLogin(page, username, password);
      }
    }
    assert.equal((await api(web)).status, 401);
    record('session_api_rejects_anonymous');
    const csrf = await api(web, undefined, {
      path: 'login',
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    });
    assert.equal(csrf.status, 403);
    record('login_rejects_cross_origin_post');
    let callbackUrl;
    page.on('request', (r) => {
      if (r.url().includes('/api/session/callback?')) callbackUrl = r.url();
    });
    await login(page, 'demo', 'Demo1234!');
    record('real_confidential_oidc_code_exchange_on_server');
    const aliceCookie = await cookies(ctx);
    assert.ok(aliceCookie?.httpOnly);
    assert.equal(aliceCookie.sameSite, 'Lax');
    assert.equal(aliceCookie.value.length, 43);
    assert.equal(aliceCookie.secure, httpsMode);
    record(
      httpsMode
        ? 'http_only_secure_host_cookie_without_insecure_development_exception'
        : 'http_only_opaque_cookie_with_explicit_loopback_development_exception',
    );
    if (tlsFixture)
      await tlsFixture.verifyBrowser(page, ctx, aliceCookie, record);
    assert.deepEqual(
      await page.evaluate(() => ({
        session: sessionStorage.length,
        local: localStorage.length,
        visible: document.cookie.includes('idenplane_session'),
      })),
      { session: 0, local: 0, visible: false },
    );
    assert.deepEqual(browserTokenRequests, []);
    record(
      'no_access_or_refresh_tokens_in_browser_storage_or_browser_token_requests',
    );
    const aliceProfile = await api(web, aliceCookie.value);
    assert.equal(aliceProfile.status, 200);
    const aliceBody = await aliceProfile.json();
    assert.equal(aliceBody.profile.id, alice.id);
    assert.deepEqual(Object.keys(aliceBody), ['profile']);
    assert.match(aliceProfile.headers.get('cache-control'), /no-store/);
    record('session_profile_exposes_only_own_allowlisted_claims');
    const stored = (
      await sessionPool.query(
        'SELECT sid_hash,payload FROM bff_sessions WHERE kind=$1',
        ['session'],
      )
    ).rows;
    assert.ok(stored.length === 1);
    assert.ok(!JSON.stringify(stored).includes(aliceCookie.value));
    assert.ok(!stored[0].payload.includes('demo@example.com'));
    record('database_has_hashed_cookie_and_encrypted_credentials');
    const { SessionCipher } = await import(
      pathToFileURL(path.join(example, 'lib/session/crypto.ts')).href
    );
    const cipher = new SessionCipher(Buffer.from(sessionKey, 'hex')),
      hash = crypto
        .createHash('sha256')
        .update(aliceCookie.value)
        .digest('hex');
    const initial = cipher.open(stored[0].payload, 'session:' + hash);
    assert.equal(
      (
        await api(web, undefined, {
          headers: { authorization: 'Bearer ' + initial.accessToken },
        })
      ).status,
      401,
    );
    record('valid_bearer_token_cannot_bypass_cookie_session_gate');
    const replay = await fetch(callbackUrl, {
      redirect: 'manual',
      headers: { cookie: cookieName + '=' + aliceCookie.value },
    });
    assert.ok(replay.headers.get('location').includes('error=login_failed'));
    assert.equal((await cookies(ctx)).value, aliceCookie.value);
    record('callback_replay_cannot_create_or_replace_session');
    assert.equal((await api(replica, aliceCookie.value)).status, 200);
    record('same_session_works_on_second_worker');
    docker(['restart', names[0]]);
    await ready(web + '/server-session');
    assert.equal((await api(web, aliceCookie.value)).status, 200);
    record('session_survives_nextjs_worker_restart');
    const bobContext = await browser.newContext(),
      bobPage = await bobContext.newPage();
    await login(bobPage, 'other', 'OtherDemo1234!');
    const bobCookie = await cookies(bobContext);
    assert.equal(
      (
        await api(web, aliceCookie.value, {
          path: 'users/' + bob.id + '/profile',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await api(replica, bobCookie.value, {
          path: 'users/' + alice.id + '/profile',
        })
      ).status,
      403,
    );
    record('cross_user_access_rejected_on_both_workers');
    const bobProfile = await api(replica, bobCookie.value);
    assert.equal((await bobProfile.json()).profile.id, bob.id);
    record('second_user_receives_own_profile');
    const beforeRefresh = initial.accessExpiresAt - Date.now() - 29000;
    if (beforeRefresh > 0)
      await new Promise((r) => setTimeout(r, beforeRefresh));
    const refreshed = await Promise.all([
      api(web, aliceCookie.value),
      api(replica, aliceCookie.value),
    ]);
    assert.ok(refreshed.every((r) => r.status === 200));
    const row = (
      await sessionPool.query(
        'SELECT payload FROM bff_sessions WHERE sid_hash=$1',
        [hash],
      )
    ).rows[0];
    const next = cipher.open(row.payload, 'session:' + hash);
    assert.notEqual(next.refreshToken, initial.refreshToken);
    record('server_side_refresh_rotation_with_concurrent_workers');
    await page.reload();
    await page.getByRole('heading', { name: 'Signed in securely' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: dir + '/server-session-mobile.png',
      fullPage: true,
    });
    record('session_reload_and_mobile_without_overflow');
    const badLogout = await api(web, aliceCookie.value, {
      path: 'logout',
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    });
    assert.equal(badLogout.status, 403);
    assert.equal((await api(replica, aliceCookie.value)).status, 200);
    record('logout_csrf_rejected_without_revoking_valid_session');
    await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
    await page.waitForURL(web + '/server-session', { timeout: 20000 });
    await page
      .getByRole('button', { name: 'Sign in securely', exact: true })
      .waitFor();
    record('logout_revokes_session_and_returns_from_provider');
    assert.equal((await api(web, aliceCookie.value)).status, 401);
    assert.equal((await api(replica, aliceCookie.value)).status, 401);
    assert.equal(
      (
        await sessionPool.query(
          'SELECT count(*)::int AS count FROM bff_sessions WHERE sid_hash=$1',
          [hash],
        )
      ).rows[0].count,
      0,
    );
    record('copied_cookie_rejected_immediately_on_all_workers_after_logout');
    const revoked = await fetch(
      base + '/realms/quickstart/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'nextjs-session',
          client_secret: confidential.clientSecret,
          refresh_token: next.refreshToken,
        }),
      },
    );
    assert.ok(revoked.status >= 400);
    record('provider_refresh_credential_revoked');
    await page
      .getByRole('button', { name: 'Sign in securely', exact: true })
      .click();
    await page.locator('input[name="username"]').waitFor();
    record('sign_in_after_logout_requires_credentials');
    await sessionPool.query(
      "UPDATE bff_sessions SET last_seen_at=clock_timestamp()-interval '2 hours' WHERE sid_hash=$1",
      [crypto.createHash('sha256').update(bobCookie.value).digest('hex')],
    );
    assert.equal((await api(replica, bobCookie.value)).status, 401);
    record('idle_timeout_rejects_another_user_session');
    await bobContext.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(browserTokenRequests, []);
    record('no_browser_javascript_errors_or_client_token_exchange');
    docker(['stop', names[2]]);
    assert.equal((await api(replica, bobCookie.value)).status, 503);
    record('database_outage_fails_closed_without_returning_cached_profile');
    const unconfirmed = await api(web, bobCookie.value, {
      path: 'logout',
      method: 'POST',
      headers: { origin: web },
    });
    assert.equal(unconfirmed.status, 503);
    assert.equal(unconfirmed.headers.get('location'), null);
    record('database_outage_never_reports_successful_logout');
    failed = false;
  } finally {
    if (failed) saveContainerLogs();
    if (browser) await browser.close();
    if (fixture) await new Promise((r) => fixture.close(r));
    await sessionPool?.end();
    await rootPool?.end();
    for (const name of names) {
      const inspected = run(['inspect', name]);
      if (inspected.status === 0) {
        assert.equal(
          JSON.parse(inspected.stdout)[0].Config.Labels['idenplane.validation'],
          tag,
        );
        docker(['rm', '-f', '-v', name]);
      }
    }
    tlsFixture?.close();
    const network = run(['network', 'inspect', tag]);
    if (network.status === 0) {
      assert.equal(
        JSON.parse(network.stdout)[0].Labels['idenplane.validation'],
        tag,
      );
      docker(['network', 'rm', tag]);
    }
    cleanup = true;
  }
  save();
  console.log(
    JSON.stringify({ success: true, checks: checks.length, cleanup }),
  );
})().catch((e) => {
  save(
    e.message.replace(/id_token_hint=[^&\s"\\]+/g, 'id_token_hint=REDACTED'),
  );
  console.error(
    e.message.replace(/id_token_hint=[^&\s"\\]+/g, 'id_token_hint=REDACTED'),
  );
  process.exitCode = 1;
});
