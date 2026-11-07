#!/usr/bin/env node
// Signs in to the running demo the way a browser does and checks that the
// protected app receives the identity. Run after `docker compose up -d --wait`:
//
//   node check-flow.mjs
//
// It talks to Traefik on 127.0.0.1:80 and names the host in each request, so
// it works whether or not this machine resolves *.localhost. Cookies are kept
// the way a browser keeps them for *.localhost (Secure is honoured there).
import http from 'node:http';

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 80);
const jar = [];

function store(url, setCookies) {
  const host = new URL(url).hostname;
  for (const raw of setCookies) {
    const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    const cookie = { name: pair.slice(0, eq), value: pair.slice(eq + 1), domain: host, hostOnly: true, path: '/' };
    let expired = false;
    for (const attr of attrs) {
      const [k, v = ''] = attr.split('=');
      if (/^domain$/i.test(k)) Object.assign(cookie, { domain: v.replace(/^\./, ''), hostOnly: false });
      if (/^path$/i.test(k)) cookie.path = v;
      if (/^expires$/i.test(k) && new Date(v) < new Date()) expired = true;
      if (/^max-age$/i.test(k) && Number(v) <= 0) expired = true;
    }
    const i = jar.findIndex((c) => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path);
    if (i >= 0) jar.splice(i, 1);
    if (!expired && cookie.value) jar.push(cookie);
  }
}

function cookiesFor(url) {
  const u = new URL(url);
  return jar
    .filter((c) => (c.hostOnly ? u.hostname === c.domain : u.hostname === c.domain || u.hostname.endsWith(`.${c.domain}`)))
    .filter((c) => u.pathname.startsWith(c.path))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function send(url, { method = 'GET', body, headers = {} } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PROXY_PORT,
        method,
        path: u.pathname + u.search,
        headers: { Host: u.host, Accept: 'text/html', 'User-Agent': 'check-flow', Cookie: cookiesFor(url), ...headers },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          store(url, [].concat(res.headers['set-cookie'] ?? []));
          resolve({ status: res.statusCode, location: res.headers.location, text });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function follow(url, opts) {
  for (let hop = 0; hop < 12; hop++) {
    const res = await send(url, opts);
    console.log(`${res.status} ${url.length > 110 ? `${url.slice(0, 110)}…` : url}`);
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = new URL(res.location, url).toString();
      opts = undefined;
      continue;
    }
    return { ...res, url };
  }
  throw new Error('too many redirects');
}

const fail = (msg) => {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
};

let page = await follow('http://app.localhost/');
const form = page.text.match(/<form method="POST" action="([^"]+)"/);
if (page.status !== 200 || !form) fail(`expected the Idenplane login page, got HTTP ${page.status} at ${page.url}`);

const fields = new URLSearchParams();
for (const m of page.text.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
  fields.set(m[1], m[2].replace(/&amp;/g, '&').replace(/&#x3D;/g, '=').replace(/&#x2F;/g, '/'));
}
fields.set('username', 'demo');
fields.set('password', 'demo1234');

console.log('-- signing in as demo');
page = await follow(new URL(form[1], page.url).toString(), {
  method: 'POST',
  body: fields.toString(),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});

if (page.url !== 'http://app.localhost/') fail(`ended at ${page.url}, not back at the app`);
if (!/X-Forwarded-User: demo/i.test(page.text)) fail(`the app did not receive the identity:\n${page.text}`);
console.log(`\nOK: whoami received\n${page.text.split('\n').filter((l) => /^X-Forwarded-(User|Email)/i.test(l)).join('\n')}`);
