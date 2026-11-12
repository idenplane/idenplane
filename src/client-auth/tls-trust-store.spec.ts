import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePemBundle, TlsTrustStore } from './tls-trust-store.js';
import { issue } from './__mocks__/test-pki.js';

describe('TlsTrustStore', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'idenplane-anchors-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const store = (file: string | undefined, enabled = true) =>
    new TlsTrustStore(
      {
        realmTlsTrustAnchor: { findMany: jest.fn(async () => []) },
      } as never,
      { enabled, globalTrustAnchorsFile: file } as never,
    );

  it('loads the global anchors and serves them only to realms that opt in', async () => {
    const a = await issue({ ca: true, cn: 'A' });
    const b = await issue({ ca: true, cn: 'B' });
    const file = join(dir, 'bundle.pem');
    writeFileSync(file, `${a.pem}\n${b.pem}`);
    const s = store(file);
    await s.onModuleInit();
    expect(await s.anchors({ id: 'r' })).toHaveLength(0);
    expect(
      await s.anchors({ id: 'r', mtlsTrustGlobalAnchors: true }),
    ).toHaveLength(2);
  });

  it('does not read the file while mTLS is off', async () => {
    await expect(
      store(join(dir, 'missing.pem'), false).onModuleInit(),
    ).resolves.toBeUndefined();
  });

  it('stops startup on an unreadable file or a non-CA certificate', async () => {
    await expect(
      store(join(dir, 'missing.pem')).onModuleInit(),
    ).rejects.toThrow();
    const leaf = await issue({ cn: 'leaf' });
    const file = join(dir, 'leaf.pem');
    writeFileSync(file, leaf.pem);
    await expect(store(file).onModuleInit()).rejects.toThrow(/not a CA/);
  });

  it('refuses a bundle with a private key or no certificate', async () => {
    const ca = await issue({ ca: true });
    expect(() => parsePemBundle(`${ca.pem}${ca.privateKeyPem}`, 'f')).toThrow(
      /private key/,
    );
    expect(() => parsePemBundle('nothing', 'f')).toThrow(/no PEM/);
  });
});
