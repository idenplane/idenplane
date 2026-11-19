// Checks a bootstrapped instance from the outside, as a client would:
// the setup wizard is closed for good and the declared client gets tokens.
// Runs in a bare node:24-alpine container next to the app (see run.sh).
import { env, log, assert } from '../lib/idenplane.mjs';

const base = env('IDENPLANE_URL').replace(/\/$/, '');
const apiKey = env('ADMIN_API_KEY');
const realm = env('REALM');
const clientId = env('CLIENT_ID');
const clientSecret = env('CLIENT_SECRET');

const admin = (path, init = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: {
      'x-admin-api-key': apiKey,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

const status = await (await admin('/setup-wizard/status')).json();
log('wizard status', JSON.stringify({
  wizardCompleted: status.wizardCompleted,
  wizardSkipped: status.wizardSkipped,
}));
assert(status.wizardCompleted === true, 'the setup wizard is completed');

for (const path of ['/setup-wizard/complete', '/setup-wizard/skip', '/setup-wizard/reset']) {
  const res = await admin(path, { method: 'POST', body: '{}' });
  assert(res.status === 409, `${path} answers 409 (got ${res.status})`);
}

const realms = await (await admin('/admin/realms')).json();
const names = (Array.isArray(realms) ? realms : realms.data ?? []).map((r) => r.name);
log('realms', names.join(', '));
assert(names.filter((n) => n === realm).length === 1, `realm ${realm} exists once`);

const token = await fetch(`${base}/realms/${realm}/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }),
});
assert(token.status === 200, `client_credentials token answers 200 (got ${token.status})`);
assert(typeof (await token.json()).access_token === 'string', 'an access token is issued');
log('OK');
