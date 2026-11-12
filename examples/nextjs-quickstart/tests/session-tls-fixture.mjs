import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';

// This fixture never installs a CA in the user's trust store. The browser
// exception is restricted to a fresh fixture key; Node verifies CA + hostname.
export function createTlsFixture({ docker, run, backendImage, tag, ports }) {
  const generation = `require('reflect-metadata');
const x=require('@peculiar/x509');
(async()=>{const algorithm={name:'ECDSA',namedCurve:'P-256',hash:'SHA-256'};
const makeKeys=()=>crypto.subtle.generateKey(algorithm,true,['sign','verify']);
const caKeys=await makeKeys(),keys=await makeKeys(),dates={notBefore:new Date(Date.now()-60000),notAfter:new Date(Date.now()+86400000)};
const ca=await x.X509CertificateGenerator.createSelfSigned({name:'CN=Disposable session test CA',keys:caKeys,signingAlgorithm:algorithm,...dates,extensions:[new x.BasicConstraintsExtension(true,0,true),new x.KeyUsagesExtension(x.KeyUsageFlags.keyCertSign,true)]},crypto);
const cert=await x.X509CertificateGenerator.create({subject:'CN=app.idenplane.test',issuer:ca.subject,publicKey:keys.publicKey,signingKey:caKeys.privateKey,signingAlgorithm:algorithm,...dates,extensions:[new x.BasicConstraintsExtension(false,undefined,true),new x.KeyUsagesExtension(x.KeyUsageFlags.digitalSignature,true),new x.ExtendedKeyUsageExtension([x.ExtendedKeyUsage.serverAuth]),new x.SubjectAlternativeNameExtension(['app.idenplane.test','login.idenplane.test','session-tls'].map(value=>({type:'dns',value})))]},crypto);
const der=Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey));
const key='-----BEGIN PRIVATE KEY-----\\n'+der.toString('base64').match(/.{1,64}/g).join('\\n')+'\\n-----END PRIVATE KEY-----';
console.log(JSON.stringify({ca:ca.toString('pem'),cert:cert.toString('pem'),key}));})().catch(()=>process.exit(1));`;
  const credentials = JSON.parse(
    docker([
      'run',
      '--rm',
      '--entrypoint',
      'node',
      backendImage,
      '-e',
      generation,
    ]),
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'idenplane-test-tls-'),
  );
  fs.chmodSync(directory, 0o700);
  for (const [name, data] of Object.entries({
    'ca.pem': credentials.ca,
    'leaf.pem': credentials.cert,
    'leaf.key': credentials.key,
  }))
    fs.writeFileSync(path.join(directory, name), data, { mode: 0o600 });
  const spki = createHash('sha256')
    .update(
      new X509Certificate(credentials.cert).publicKey.export({
        format: 'der',
        type: 'spki',
      }),
    )
    .digest('base64');
  const name = tag + '-tls',
    browserName = tag + '-browser';
  const origin = (host, port) => `https://${host}:${port}`;
  const base = origin('login.idenplane.test', ports.idp),
    web = origin('app.idenplane.test', ports.web),
    replica = origin('app.idenplane.test', ports.replica);
  const config = `{
  admin off
  auto_https off
}
:443, :${ports.idp} {
  tls /fixture/leaf.pem /fixture/leaf.key
  reverse_proxy ${tag}-app:3000
}
:444, :${ports.web} {
  tls /fixture/leaf.pem /fixture/leaf.key
  reverse_proxy ${tag}-web:3001
}
:445, :${ports.replica} {
  tls /fixture/leaf.pem /fixture/leaf.key
  reverse_proxy ${tag}-replica:3001
}
:80, :${ports.plain} {
  respond "plain HTTP fixture" 200
}
`;
  fs.writeFileSync(path.join(directory, 'Caddyfile'), config, { mode: 0o600 });
  const lookup = (hostname, options, callback) => {
    if (!['app.idenplane.test', 'login.idenplane.test'].includes(hostname))
      return callback(new Error('Unexpected fixture hostname'));
    callback(
      null,
      options?.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1',
      options?.all ? undefined : 4,
    );
  };
  function request(input, init = {}, trust = credentials.ca) {
    const url = new URL(input),
      transport = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const body = init.body === undefined ? undefined : String(init.body);
      const headers = new Headers(init.headers);
      if (body !== undefined)
        headers.set('Content-Length', String(Buffer.byteLength(body)));
      const req = transport.request(
        url,
        {
          method: init.method ?? 'GET',
          headers: Object.fromEntries(headers),
          lookup,
          ca: trust,
          rejectUnauthorized: true,
          timeout: 10000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (data) => chunks.push(data));
          res.on('end', () => {
            const responseHeaders = new Headers();
            for (let n = 0; n < res.rawHeaders.length; n += 2)
              responseHeaders.append(res.rawHeaders[n], res.rawHeaders[n + 1]);
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode,
                headers: responseHeaders,
              }),
            );
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () =>
        req.destroy(new Error('Fixture request timeout')),
      );
      req.end(body);
    });
  }
  return {
    base,
    web,
    replica,
    fetch: request,
    containerArgs: [
      '--mount',
      `type=bind,source=${path.join(directory, 'ca.pem')},target=/fixture-ca.pem,readonly`,
    ],
    containerEnvironment: {
      NODE_EXTRA_CA_CERTS: '/fixture-ca.pem',
      IDENPLANE_INTERNAL_URL: 'https://session-tls',
      SESSION_ALLOW_INSECURE_LOCALHOST: 'false',
    },
    start() {
      docker([
        'run',
        '-d',
        '--name',
        name,
        '--label',
        'idenplane.validation=' + tag,
        '--network',
        tag,
        '--network-alias',
        'session-tls',
        // The browser container reaches the proxy by these names too.
        '--network-alias',
        'app.idenplane.test',
        '--network-alias',
        'login.idenplane.test',
        '--mount',
        `type=bind,source=${directory},target=/fixture,readonly`,
        '-p',
        `127.0.0.1:${ports.idp}:${ports.idp}`,
        '-p',
        `127.0.0.1:${ports.web}:${ports.web}`,
        '-p',
        `127.0.0.1:${ports.replica}:${ports.replica}`,
        '-p',
        `127.0.0.1:${ports.plain}:${ports.plain}`,
        'caddy:2.10-alpine',
        'caddy',
        'run',
        '--config',
        '/fixture/Caddyfile',
        '--adapter',
        'caddyfile',
      ]);
    },
    /**
     * Runs Chromium in a Playwright server container on the test network
     * rather than on the host. On shared CI runners the host's interfaces
     * change while containers start, and a host browser aborts requests with
     * ERR_NETWORK_CHANGED; the container's own network namespace does not see
     * those changes. Caddy listens on the host port numbers inside the
     * network too, so the browser uses the same URLs.
     */
    async launchBrowser(chromium, playwrightVersion) {
      // launchServer, unlike `playwright run-server`, takes the browser flags:
      // the certificate exception stays limited to this fixture's key.
      const server = `
const { chromium } = require('/tmp/pw/node_modules/playwright');
chromium
  .launchServer({
    host: '0.0.0.0',
    port: 3333,
    wsPath: '/playwright',
    headless: true,
    args: ['--no-proxy-server', '--ignore-certificate-errors-spki-list=${spki}'],
  })
  .then(() => console.log('playwright server ready'));`;
      docker([
        'run',
        '-d',
        '--name',
        browserName,
        '--label',
        'idenplane.validation=' + tag,
        '--network',
        tag,
        '-p',
        `127.0.0.1:${ports.browser}:3333`,
        '--init',
        `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`,
        'sh',
        '-c',
        `npm install --silent --prefix /tmp/pw playwright@${playwrightVersion} && node -e "$0"`,
        server,
      ]);
      let lastError;
      for (let attempt = 0; attempt < 90; attempt++) {
        try {
          return await chromium.connect(
            `ws://127.0.0.1:${ports.browser}/playwright`,
            { timeout: 5000 },
          );
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      const logs = run(['logs', '--tail', '40', browserName]);
      throw new Error(
        'Playwright server did not start: ' + (logs.stdout + logs.stderr),
        { cause: lastError },
      );
    },
    async verifyTrust() {
      assert.equal((await request(base + '/health/ready')).status, 200);
      await assert.rejects(request(base + '/health/ready', {}, []), (error) =>
        [
          'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
          'SELF_SIGNED_CERT_IN_CHAIN',
          'DEPTH_ZERO_SELF_SIGNED_CERT',
        ].includes(error.code),
      );
      await assert.rejects(
        new Promise((resolve, reject) => {
          const req = https.get(
            {
              hostname: '127.0.0.1',
              port: ports.idp,
              ca: credentials.ca,
              rejectUnauthorized: true,
            },
            resolve,
          );
          req.on('error', reject);
        }),
        { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
      );
    },
    async verifyBrowser(page, context, cookie, record) {
      assert.equal(cookie.name, '__Host-idenplane_session');
      assert.equal(cookie.secure, true);
      assert.equal(cookie.httpOnly, true);
      assert.equal(cookie.path, '/');
      assert.equal(cookie.domain, 'app.idenplane.test');
      assert.ok(
        !(await context.cookies(base)).some(
          (item) => item.name === cookie.name,
        ),
      );
      record('host_cookie_not_shared_with_identity_provider_domain');
      const plainRequest = page.waitForRequest((req) =>
        req.url().startsWith(`http://app.idenplane.test:${ports.plain}`),
      );
      await page.goto(`http://app.idenplane.test:${ports.plain}/`);
      const httpCookie = (await (await plainRequest).allHeaders()).cookie ?? '';
      assert.ok(!httpCookie.includes(cookie.name));
      record('secure_session_cookie_not_sent_over_plain_http');
      await page.goto(web + '/server-session');
      await page.getByRole('heading', { name: 'Signed in securely' }).waitFor();
      record('secure_host_bound_cookie_used_in_real_https_browser');
    },
    close() {
      for (const container of [name, browserName]) {
        const inspected = run(['inspect', container]);
        if (inspected.status === 0) {
          assert.equal(
            JSON.parse(inspected.stdout)[0].Config.Labels[
              'idenplane.validation'
            ],
            tag,
          );
          docker(['rm', '-f', '-v', container]);
        }
      }
      for (const file of ['ca.pem', 'leaf.pem', 'leaf.key', 'Caddyfile'])
        fs.unlinkSync(path.join(directory, file));
      fs.rmdirSync(directory);
    },
  };
}
