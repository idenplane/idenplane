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
  const name = tag + '-tls';
  const origin = (host, port) => `https://${host}:${port}`;
  const base = origin('login.idenplane.test', ports.idp),
    web = origin('app.idenplane.test', ports.web),
    replica = origin('app.idenplane.test', ports.replica);
  const config = `{
  admin off
  auto_https off
}
:443 {
  tls /fixture/leaf.pem /fixture/leaf.key
  reverse_proxy ${tag}-app:3000
}
:444 {
  tls /fixture/leaf.pem /fixture/leaf.key
  reverse_proxy ${tag}-web:3001
}
:445 {
  tls /fixture/leaf.pem /fixture/leaf.key
  reverse_proxy ${tag}-replica:3001
}
:80 {
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
    browserArgs: [
      '--host-resolver-rules=MAP app.idenplane.test 127.0.0.1, MAP login.idenplane.test 127.0.0.1',
      '--no-proxy-server',
      '--ignore-certificate-errors-spki-list=' + spki,
    ],
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
        '--mount',
        `type=bind,source=${directory},target=/fixture,readonly`,
        '-p',
        `127.0.0.1:${ports.idp}:443`,
        '-p',
        `127.0.0.1:${ports.web}:444`,
        '-p',
        `127.0.0.1:${ports.replica}:445`,
        '-p',
        `127.0.0.1:${ports.plain}:80`,
        'caddy:2.10-alpine',
        'caddy',
        'run',
        '--config',
        '/fixture/Caddyfile',
        '--adapter',
        'caddyfile',
      ]);
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
      const inspected = run(['inspect', name]);
      if (inspected.status === 0) {
        assert.equal(
          JSON.parse(inspected.stdout)[0].Config.Labels['idenplane.validation'],
          tag,
        );
        docker(['rm', '-f', '-v', name]);
      }
      for (const file of ['ca.pem', 'leaf.pem', 'leaf.key', 'Caddyfile'])
        fs.unlinkSync(path.join(directory, file));
      fs.rmdirSync(directory);
    },
  };
}
