// Turns the app's own OpenAPI document (/api-json) into what the ZAP API scan
// should attack:
//   - `servers` points at the running instance;
//   - every {realmName} path parameter is pinned to the seeded realm
//     "zapapi", so requests reach real handlers instead of 404-ing on a
//     random realm name;
//   - the one operation that would delete that realm mid-scan is dropped
//     (it is still covered by the e2e suite).
import { writeFileSync } from 'node:fs';
import { env, log } from '../lib/idenplane.mjs';

const base = env('IDENPLANE_URL');
const realm = process.env.ZAP_API_REALM ?? 'zapapi';
const res = await fetch(`${base}/api-json`);
if (!res.ok) throw new Error(`/api-json returned ${res.status}`);
const doc = await res.json();

doc.servers = [{ url: base }];
const paths = {};
let ops = 0;
for (const [path, item] of Object.entries(doc.paths ?? {})) {
  const pinned = path.replaceAll('{realmName}', realm);
  for (const [method, op] of Object.entries(item)) {
    if (typeof op !== 'object' || !op) continue;
    if (Array.isArray(op.parameters)) {
      op.parameters = op.parameters.filter((p) => !(p.in === 'path' && p.name === 'realmName'));
    }
    if (method === 'delete' && pinned === `/admin/realms/${realm}`) {
      delete item[method];
      continue;
    }
    ops++;
  }
  if (Array.isArray(item.parameters)) {
    item.parameters = item.parameters.filter((p) => !(p.in === 'path' && p.name === 'realmName'));
  }
  paths[pinned] = item;
}
doc.paths = paths;
writeFileSync('/out/openapi.json', JSON.stringify(doc));
log(`OpenAPI prepared: ${Object.keys(paths).length} paths, ${ops} operations, realm pinned to ${realm}`);
