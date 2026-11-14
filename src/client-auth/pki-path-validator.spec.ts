import 'reflect-metadata';
import { KeyUsageFlags } from '@peculiar/x509';
import {
  PkiPathValidator,
  type PkiValidationInput,
} from './pki-path-validator.js';
import {
  chain,
  issue,
  nameConstraints,
  OIDS,
  unknownCritical,
  type TestIdentity,
} from './__mocks__/test-pki.js';

const DAY = 86_400_000;

describe('PkiPathValidator', () => {
  const validator = new PkiPathValidator();
  let root: TestIdentity;
  let intermediate: TestIdentity;
  let leaf: TestIdentity;

  beforeAll(async () => {
    ({ root, intermediate, leaf } = await chain({ cn: 'device-1' }));
  });

  const run = (overrides: Partial<PkiValidationInput> = {}) =>
    validator.validate({
      leaf: leaf.certificate,
      intermediates: [intermediate.certificate],
      anchors: [root.certificate],
      maxChainDepth: 5,
      ...overrides,
    });

  it('accepts leaf → intermediate → anchor', () => {
    const result = run();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path.map((c) => c.subject)).toEqual([
        leaf.certificate.subject,
        intermediate.certificate.subject,
        root.certificate.subject,
      ]);
    }
  });

  it('accepts a leaf issued directly by the anchor', async () => {
    const direct = await issue({ issuer: root, eku: [OIDS.clientAuth] });
    expect(run({ leaf: direct.certificate, intermediates: [] }).ok).toBe(true);
  });

  it('accepts a presented chain that repeats the anchor', () => {
    expect(
      run({ intermediates: [root.certificate, intermediate.certificate] }).ok,
    ).toBe(true);
  });

  it('refuses a chain to an anchor the realm does not trust', async () => {
    const other = await issue({ ca: true, cn: 'Other Root' });
    expect(run({ anchors: [other.certificate] })).toEqual({
      ok: false,
      reason: 'untrusted',
    });
  });

  it('refuses a missing intermediate', () => {
    expect(run({ intermediates: [] })).toEqual({
      ok: false,
      reason: 'untrusted',
    });
  });

  it('refuses no anchors at all', () => {
    expect(run({ anchors: [] })).toEqual({ ok: false, reason: 'untrusted' });
  });

  it('refuses a forged issuer with the same name but another key', async () => {
    const impostor = await issue({
      name: [{ O: ['Test PKI'] }, { CN: ['Test Intermediate'] }],
      ca: true,
      issuer: root,
    });
    expect(run({ intermediates: [impostor.certificate] }).ok).toBe(false);
  });

  it('refuses an expired leaf', async () => {
    const expired = await issue({
      issuer: intermediate,
      notBefore: new Date(Date.now() - 10 * DAY),
      notAfter: new Date(Date.now() - DAY),
    });
    expect(run({ leaf: expired.certificate })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses a leaf that is not valid yet', async () => {
    const future = await issue({
      issuer: intermediate,
      notBefore: new Date(Date.now() + DAY),
      notAfter: new Date(Date.now() + 10 * DAY),
    });
    expect(run({ leaf: future.certificate }).ok).toBe(false);
    expect(run({ leaf: future.certificate })).toMatchObject({
      reason: 'not_yet_valid',
    });
  });

  it('refuses an expired intermediate', async () => {
    const old = await issue({
      name: [{ CN: ['Old Intermediate'] }],
      ca: true,
      issuer: root,
      notBefore: new Date(Date.now() - 10 * DAY),
      notAfter: new Date(Date.now() - DAY),
    });
    const child = await issue({ issuer: old });
    expect(
      run({ leaf: child.certificate, intermediates: [old.certificate] }),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('uses the given time for every certificate', () => {
    expect(run({ now: new Date(Date.now() + 365 * DAY) })).toMatchObject({
      reason: 'expired',
    });
  });

  it('refuses an issuer without the CA flag', async () => {
    const notCa = await issue({ cn: 'Not a CA', issuer: root, ca: false });
    const child = await issue({ issuer: notCa });
    expect(
      run({ leaf: child.certificate, intermediates: [notCa.certificate] }),
    ).toEqual({ ok: false, reason: 'issuer_not_ca' });
  });

  it('refuses an issuer without basicConstraints', async () => {
    const bare = await issue({
      cn: 'Bare',
      issuer: root,
      noBasicConstraints: true,
    });
    const child = await issue({ issuer: bare });
    expect(
      run({ leaf: child.certificate, intermediates: [bare.certificate] }).ok,
    ).toBe(false);
  });

  it('refuses an issuer whose keyUsage lacks keyCertSign', async () => {
    const noSign = await issue({
      cn: 'No keyCertSign',
      issuer: root,
      ca: true,
      keyUsage: KeyUsageFlags.digitalSignature,
    });
    const child = await issue({ issuer: noSign });
    expect(
      run({ leaf: child.certificate, intermediates: [noSign.certificate] }).ok,
    ).toBe(false);
  });

  it('refuses a path longer than the anchor pathLen allows', async () => {
    const strictRoot = await issue({
      cn: 'Strict Root',
      ca: true,
      pathLength: 0,
    });
    const mid = await issue({ cn: 'Mid', ca: true, issuer: strictRoot });
    const child = await issue({ issuer: mid });
    expect(
      run({
        leaf: child.certificate,
        intermediates: [mid.certificate],
        anchors: [strictRoot.certificate],
      }),
    ).toEqual({ ok: false, reason: 'path_length_exceeded' });
  });

  it('refuses a path longer than an intermediate pathLen allows', async () => {
    const mid1 = await issue({
      cn: 'Mid1',
      ca: true,
      pathLength: 0,
      issuer: root,
    });
    const mid2 = await issue({ cn: 'Mid2', ca: true, issuer: mid1 });
    const child = await issue({ issuer: mid2 });
    expect(
      run({
        leaf: child.certificate,
        intermediates: [mid2.certificate, mid1.certificate],
      }),
    ).toEqual({ ok: false, reason: 'path_length_exceeded' });
  });

  it('accepts a path within pathLen', async () => {
    const mid1 = await issue({
      cn: 'Mid1b',
      ca: true,
      pathLength: 1,
      issuer: root,
    });
    const mid2 = await issue({ cn: 'Mid2b', ca: true, issuer: mid1 });
    const child = await issue({ issuer: mid2 });
    expect(
      run({
        leaf: child.certificate,
        intermediates: [mid1.certificate, mid2.certificate],
      }).ok,
    ).toBe(true);
  });

  it('refuses a path deeper than MTLS_MAX_CHAIN_DEPTH', () => {
    expect(run({ maxChainDepth: 1 })).toEqual({
      ok: false,
      reason: 'chain_too_long',
    });
    expect(run({ maxChainDepth: 2 }).ok).toBe(true);
  });

  it('refuses an unknown critical extension, on the leaf or an issuer', async () => {
    const odd = await issue({
      issuer: intermediate,
      extraExtensions: [unknownCritical()],
    });
    expect(run({ leaf: odd.certificate })).toEqual({
      ok: false,
      reason: 'unknown_critical_extension',
    });
    const oddCa = await issue({
      cn: 'Odd CA',
      ca: true,
      issuer: root,
      extraExtensions: [unknownCritical()],
    });
    const child = await issue({ issuer: oddCa });
    expect(
      run({ leaf: child.certificate, intermediates: [oddCa.certificate] }),
    ).toEqual({ ok: false, reason: 'unknown_critical_extension' });
  });

  it('refuses nameConstraints, which are not supported', async () => {
    const constrained = await issue({
      cn: 'Constrained CA',
      ca: true,
      issuer: root,
      extraExtensions: [nameConstraints()],
    });
    const child = await issue({ issuer: constrained });
    expect(
      run({
        leaf: child.certificate,
        intermediates: [constrained.certificate],
      }),
    ).toEqual({ ok: false, reason: 'name_constraints' });
  });

  it('refuses a leaf whose EKU lacks clientAuth', async () => {
    const server = await issue({
      issuer: intermediate,
      eku: [OIDS.serverAuth],
    });
    expect(run({ leaf: server.certificate })).toEqual({
      ok: false,
      reason: 'leaf_eku',
    });
  });

  it('does not take anyExtendedKeyUsage for clientAuth', async () => {
    const any = await issue({ issuer: intermediate, eku: [OIDS.anyEku] });
    expect(run({ leaf: any.certificate })).toMatchObject({
      reason: 'leaf_eku',
    });
  });

  it('accepts a leaf without an EKU extension', async () => {
    const plain = await issue({ issuer: intermediate });
    expect(run({ leaf: plain.certificate }).ok).toBe(true);
  });

  it('refuses a CA certificate as the leaf', async () => {
    const caLeaf = await issue({
      cn: 'CA leaf',
      ca: true,
      issuer: intermediate,
    });
    expect(run({ leaf: caLeaf.certificate })).toEqual({
      ok: false,
      reason: 'leaf_is_ca',
    });
  });

  it('refuses the anchor presented as the leaf', () => {
    expect(run({ leaf: root.certificate, intermediates: [] })).toEqual({
      ok: false,
      reason: 'leaf_is_anchor',
    });
  });

  it('refuses a revoked leaf or intermediate', () => {
    expect(
      run({
        isRevoked: (c) => c.fingerprint256 === leaf.certificate.fingerprint256,
      }),
    ).toEqual({ ok: false, reason: 'revoked' });
    expect(
      run({
        isRevoked: (c) =>
          c.fingerprint256 === intermediate.certificate.fingerprint256,
      }),
    ).toEqual({ ok: false, reason: 'revoked' });
  });

  it('finds the good path when another candidate issuer is bad', async () => {
    const expiredRoot = await issue({
      name: [{ O: ['Test PKI'] }, { CN: ['Test Root'] }],
      ca: true,
      notBefore: new Date(Date.now() - 10 * DAY),
      notAfter: new Date(Date.now() - DAY),
    });
    expect(
      run({ anchors: [expiredRoot.certificate, root.certificate] }).ok,
    ).toBe(true);
  });
});
