// Dependency-free helpers for the CI drills (restore drill, upgrade test,
// DAST seeding). They talk to a running Idenplane over HTTP exactly the way a
// browser and an OAuth client would, so they work against any build: the
// image from this commit, or a previously published release.
//
// Node 22+ only (global fetch, node:crypto). No npm install needed, so the
// scripts run in a bare `node:24-alpine` container next to the app.
import { createHmac, createHash, randomBytes } from 'node:crypto';

export function env(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`${name} is not set`);
  return v;
}

export function log(...args) {
  console.log('[drill]', ...args);
}

export function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

/** A minimal cookie jar. Ignores Secure/Path on purpose: one host, one test. */
export class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  store(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) ||
        attrs.some((a) => /^\s*expires=Thu, 01 Jan 1970/i.test(a));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get(name) {
    return this.cookies.get(name);
  }
}

export class Idenplane {
  constructor(baseUrl, adminApiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.adminApiKey = adminApiKey;
  }

  url(path) {
    return path.startsWith('http') ? path : `${this.baseUrl}${path}`;
  }

  async waitReady(timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      try {
        const r = await fetch(this.url('/health/ready'));
        if (r.ok) return;
        last = `HTTP ${r.status}`;
      } catch (e) {
        last = String(e.cause?.code ?? e.message);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Idenplane at ${this.baseUrl} not ready: ${last}`);
  }

  async admin(method, path, body, { expect = [200, 201, 204] } = {}) {
    const res = await fetch(this.url(`/admin${path}`), {
      method,
      headers: {
        'x-admin-api-key': this.adminApiKey,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!expect.includes(res.status)) {
      throw new Error(`${method} /admin${path} -> ${res.status}: ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  async form(path, fields, { auth } = {}) {
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    if (auth) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(auth[0])}:${encodeURIComponent(auth[1])}`).toString('base64')}`;
    const res = await fetch(this.url(path), {
      method: 'POST',
      headers,
      body: new URLSearchParams(fields).toString(),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text };
  }

  async jwks(realm) {
    const r = await fetch(this.url(`/realms/${realm}/protocol/openid-connect/certs`));
    assert(r.ok, `JWKS for ${realm} returned ${r.status}`);
    return (await r.json()).keys;
  }

  async clientCredentials(realm, clientId, secret) {
    return this.form(`/realms/${realm}/protocol/openid-connect/token`, {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: secret,
    });
  }

  async introspect(realm, clientId, secret, token) {
    return this.form(`/realms/${realm}/protocol/openid-connect/token/introspect`, {
      token,
      client_id: clientId,
      client_secret: secret,
    });
  }

  async refresh(realm, clientId, secret, refreshToken) {
    return this.form(`/realms/${realm}/protocol/openid-connect/token`, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: secret,
    });
  }

  /**
   * One browser request: sends the jar, stores Set-Cookie, never follows
   * redirects (the caller decides where to go next).
   */
  async browse(jar, method, path, fields) {
    const headers = { cookie: jar.header() };
    let body;
    if (fields) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(fields).toString();
    }
    const res = await fetch(this.url(path), { method, headers, body, redirect: 'manual' });
    jar.store(res);
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), text, headers: res.headers };
  }

  /**
   * Signs a user in through the hosted pages with the authorization code
   * flow (PKCE), answering the TOTP challenge and the consent page when they
   * appear, and returns the token response.
   */
  async browserSignIn({ realm, clientId, clientSecret, redirectUri, username, password, totpSecret, jar = new CookieJar() }) {
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(12));
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      nonce: b64url(randomBytes(12)),
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    let step = await this.browse(jar, 'GET', `/realms/${realm}/protocol/openid-connect/auth?${q}`);
    let code;
    const seen = [];
    for (let hop = 0; hop < 15 && !code; hop++) {
      if (step.status >= 300 && step.status < 400) {
        const loc = step.location;
        assert(loc, 'redirect without Location');
        if (loc.startsWith(redirectUri)) {
          const u = new URL(loc);
          assert(!u.searchParams.get('error'), `authorization error: ${loc}`);
          assert(u.searchParams.get('state') === state, 'state mismatch');
          code = u.searchParams.get('code');
          break;
        }
        seen.push(loc.split('?')[0]);
        step = await this.browse(jar, 'GET', loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc);
        continue;
      }
      assert(step.status === 200 || step.status === 201, `unexpected HTTP ${step.status} during sign-in (${seen.join(' -> ')}): ${step.text.slice(0, 300)}`);
      const action = formAction(step.text);
      const csrf = hidden(step.text, '_csrf');
      if (/name="password"/.test(step.text) && /name="username"/.test(step.text)) {
        const fields = { ...hiddenFields(step.text), username, password };
        step = await this.browse(jar, 'POST', action, fields);
      } else if (/id="totpForm"/.test(step.text)) {
        assert(totpSecret, `${username} was asked for a TOTP code but has no secret`);
        const fields = { ...hiddenFields(step.text, 'totpForm'), code: await freshTotp(totpSecret) };
        step = await this.browse(jar, 'POST', `/realms/${realm}/totp`, fields);
      } else if (/value="grant"/.test(step.text)) {
        const fields = { ...hiddenFields(step.text), action: 'grant' };
        step = await this.browse(jar, 'POST', action, fields);
      } else {
        throw new Error(`unrecognised page during sign-in (${seen.join(' -> ')}): csrf=${!!csrf} ${step.text.slice(0, 400)}`);
      }
    }
    assert(code, `no authorization code after ${seen.join(' -> ')}`);
    const tokens = await this.form(`/realms/${realm}/protocol/openid-connect/token`, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: verifier,
    });
    assert(tokens.status === 200 && tokens.json?.access_token, `code exchange failed: ${tokens.status} ${tokens.text.slice(0, 300)}`);
    return { tokens: tokens.json, jar };
  }
}

export function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function decodeJwt(token) {
  const [h, p] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
  };
}

function formAction(html) {
  const m = /<form[^>]*method="POST"[^>]*action="([^"]+)"/i.exec(html);
  return m ? m[1].replace(/&amp;/g, '&') : '';
}

function hidden(html, name) {
  const m = new RegExp(`name="${name}" value="([^"]*)"`).exec(html);
  return m ? decodeEntities(m[1]) : undefined;
}

/** Hidden inputs of the first form, or of the form with the given id. */
function hiddenFields(html, formId) {
  let scope = html;
  if (formId) {
    const start = html.indexOf(`id="${formId}"`);
    scope = start >= 0 ? html.slice(start, html.indexOf('</form>', start)) : html;
  } else {
    const start = html.search(/<form[^>]*method="POST"/i);
    scope = start >= 0 ? html.slice(start, html.indexOf('</form>', start)) : html;
  }
  const out = {};
  for (const m of scope.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
    out[m[1]] = decodeEntities(m[2]);
  }
  return out;
}

const HTML_ENTITIES = {
  '&amp;': '&',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&#x3D;': '=',
  '&#x60;': '`',
  '&#x2F;': '/',
};

/**
 * Decode the entities Handlebars escapes, in ONE pass: chained replaces
 * would turn "&amp;lt;" into "<" instead of "&lt;".
 */
function decodeEntities(s) {
  return s.replace(/&(?:amp|quot|#x27|#39|lt|gt|#x3D|#x60|#x2F);/g, (e) => HTML_ENTITIES[e]);
}

// ── TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ────────────────────────────────

function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret, step = Math.floor(Date.now() / 1000 / 30)) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1_000_000).padStart(6, '0');
}

// The server forgets nothing across a backup/restore or an upgrade: a code
// already accepted is rejected as a replay. Each call therefore waits for a
// time step no earlier call in this process (or recorded in the state file)
// has used.
const usedSteps = new Set();
export function markTotpStepUsed(step) {
  usedSteps.add(step);
}
export function lastTotpStep() {
  return usedSteps.size ? Math.max(...usedSteps) : 0;
}
export async function freshTotp(secret) {
  for (;;) {
    const step = Math.floor(Date.now() / 1000 / 30);
    if (!usedSteps.has(step) && step > lastTotpStep()) {
      usedSteps.add(step);
      return totp(secret, step);
    }
    const wait = (step + 1) * 30_000 - Date.now() + 250;
    log(`waiting ${Math.ceil(wait / 1000)}s for a fresh TOTP time step`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

export function extractTotpSecret(html) {
  const m = /<code[^>]*>([A-Z2-7=]{16,})<\/code>/.exec(html);
  return m ? m[1] : undefined;
}
