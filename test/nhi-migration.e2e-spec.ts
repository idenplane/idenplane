import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { computeX5tS256 } from '../src/mtls/client-certificate.source';
import {
  issue,
  type TestIdentity,
} from '../src/client-auth/__mocks__/test-pki';

/**
 * The nhi_certificate_binding migration against the real database: its
 * backfill statements, run on old-shape tables in a scratch schema, and the
 * same-realm triggers it installs.
 */

const MIGRATION = join(
  __dirname,
  '../prisma/migrations/20261113100000_nhi_certificate_binding/migration.sql',
);

/** The statements of the migration that start with `prefix`, verbatim. */
function statements(prefix: string): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^(\s*--[^\n]*\n)+/, '').trim())
    .filter((s) => s.startsWith(prefix));
}

describe('nhi_certificate_binding migration (e2e)', () => {
  let db: Client;
  let device: TestIdentity;
  let second: TestIdentity;

  beforeAll(async () => {
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    device = await issue({ cn: 'backfill-1' });
    second = await issue({ cn: 'backfill-2' });
  });

  afterAll(async () => {
    await db?.end();
  });

  describe('backfill', () => {
    it('idenplane_pem_x5t_s256 matches computeX5tS256 and reads only the first certificate', async () => {
      const x5t = async (pem: string) =>
        (
          await db.query<{ x5t: string | null }>(
            'SELECT idenplane_pem_x5t_s256($1) AS x5t',
            [pem],
          )
        ).rows[0].x5t;
      expect(await x5t(device.pem)).toBe(
        computeX5tS256(device.certificate.raw),
      );
      expect(await x5t(`${device.pem}\n${second.pem}`)).toBe(
        computeX5tS256(device.certificate.raw),
      );
      expect(await x5t(`${second.pem}${device.privateKeyPem}`)).toBe(
        computeX5tS256(second.certificate.raw),
      );
      expect(await x5t(device.privateKeyPem)).toBeNull();
      expect(
        await x5t(
          '-----BEGIN CERTIFICATE-----\n!!!\n-----END CERTIFICATE-----',
        ),
      ).toBeNull();
      expect(
        await x5t(
          '-----BEGIN CERTIFICATE-----\nAB=C\n-----END CERTIFICATE-----',
        ),
      ).toBeNull();
      expect(await x5t('not a pem')).toBeNull();
    });

    it('fills realm_id from the identity and the thumbprint from the PEM, on old-shape rows', async () => {
      const backfills = statements('UPDATE "nhi_credentials"');
      const notNull = statements(
        'ALTER TABLE "nhi_credentials" ALTER COLUMN "realm_id" SET NOT NULL',
      );
      expect(backfills).toHaveLength(2);
      expect(notNull).toHaveLength(1);

      const schema = `nhi_backfill_${randomUUID().replace(/-/g, '')}`;
      await db.query('BEGIN');
      try {
        await db.query(`CREATE SCHEMA ${schema}`);
        await db.query(
          `CREATE TABLE ${schema}.nhi_identities (id text PRIMARY KEY, realm_id text NOT NULL)`,
        );
        await db.query(
          `CREATE TABLE ${schema}.nhi_credentials (
             id text PRIMARY KEY, nhi_identity_id text NOT NULL,
             certificate_pem text, realm_id text, cert_thumbprint_s256 text)`,
        );
        await db.query(
          `INSERT INTO ${schema}.nhi_identities VALUES ('i-a', 'realm-a'), ('i-b', 'realm-b')`,
        );
        await db.query(
          `INSERT INTO ${schema}.nhi_credentials (id, nhi_identity_id, certificate_pem) VALUES
             ('c-1', 'i-a', $1), ('c-2', 'i-a', $2), ('c-3', 'i-b', $3), ('c-4', 'i-b', NULL)`,
          [
            device.pem,
            `${second.pem}\n${device.pem}`,
            '-----BEGIN CERTIFICATE-----\ngarbage!\n-----END CERTIFICATE-----',
          ],
        );
        await db.query(`SET LOCAL search_path TO ${schema}, public`);
        for (const statement of [...backfills, ...notNull]) {
          await db.query(statement);
        }
        const rows = (
          await db.query<{
            id: string;
            realm_id: string;
            cert_thumbprint_s256: string | null;
          }>(
            `SELECT id, realm_id, cert_thumbprint_s256 FROM ${schema}.nhi_credentials ORDER BY id`,
          )
        ).rows;
        expect(rows).toEqual([
          {
            id: 'c-1',
            realm_id: 'realm-a',
            cert_thumbprint_s256: computeX5tS256(device.certificate.raw),
          },
          {
            id: 'c-2',
            realm_id: 'realm-a',
            cert_thumbprint_s256: computeX5tS256(second.certificate.raw),
          },
          { id: 'c-3', realm_id: 'realm-b', cert_thumbprint_s256: null },
          { id: 'c-4', realm_id: 'realm-b', cert_thumbprint_s256: null },
        ]);
      } finally {
        await db.query('ROLLBACK');
      }
    });
  });

  describe('same-realm triggers', () => {
    const realmA = randomUUID();
    const realmB = randomUUID();
    const identityA = randomUUID();
    const identityB = randomUUID();

    beforeAll(async () => {
      await db.query(
        `INSERT INTO realms (id, name, updated_at) VALUES ($1, $2, now()), ($3, $4, now())`,
        [realmA, `mig-a-${realmA}`, realmB, `mig-b-${realmB}`],
      );
      await db.query(
        `INSERT INTO nhi_identities (id, realm_id, name, updated_at)
         VALUES ($1, $2, 'device', now()), ($3, $4, 'device', now())`,
        [identityA, realmA, identityB, realmB],
      );
    });

    afterAll(async () => {
      await db.query('DELETE FROM realms WHERE id = ANY($1)', [
        [realmA, realmB],
      ]);
    });

    const insertClient = (realmId: string, nhiIdentityId: string | null) =>
      db.query(
        `INSERT INTO clients (id, realm_id, client_id, updated_at, nhi_identity_id)
         VALUES ($1, $2, $3, now(), $4)`,
        [randomUUID(), realmId, `c-${randomUUID()}`, nhiIdentityId],
      );
    const insertCredential = (realmId: string, nhiIdentityId: string) =>
      db.query(
        `INSERT INTO nhi_credentials (id, realm_id, nhi_identity_id, name, updated_at)
         VALUES ($1, $2, $3, $4, now())`,
        [randomUUID(), realmId, nhiIdentityId, `cred-${randomUUID()}`],
      );

    it('refuses a client bound to an identity of another realm (23514)', async () => {
      await expect(insertClient(realmB, identityA)).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertClient(realmA, identityA)).resolves.toBeDefined();
    });

    it('refuses moving a bound client to another realm, or rebinding it across realms', async () => {
      const id = randomUUID();
      await db.query(
        `INSERT INTO clients (id, realm_id, client_id, updated_at) VALUES ($1, $2, $3, now())`,
        [id, realmB, `c-${id}`],
      );
      await expect(
        db.query('UPDATE clients SET nhi_identity_id = $1 WHERE id = $2', [
          identityA,
          id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await db.query('UPDATE clients SET nhi_identity_id = $1 WHERE id = $2', [
        identityB,
        id,
      ]);
      await expect(
        db.query('UPDATE clients SET realm_id = $1 WHERE id = $2', [
          realmA,
          id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it("refuses a credential outside its identity's realm", async () => {
      await expect(insertCredential(realmB, identityA)).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertCredential(realmA, identityA)).resolves.toBeDefined();
    });

    it('refuses moving an identity that has a client or credentials to another realm', async () => {
      await expect(
        db.query('UPDATE nhi_identities SET realm_id = $1 WHERE id = $2', [
          realmB,
          identityA,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('deleting the identity deletes its client and credentials', async () => {
      await db.query('DELETE FROM nhi_identities WHERE id = $1', [identityA]);
      const left = await db.query(
        `SELECT (SELECT count(*) FROM clients WHERE nhi_identity_id = $1)::int AS clients,
                (SELECT count(*) FROM nhi_credentials WHERE nhi_identity_id = $1)::int AS credentials`,
        [identityA],
      );
      expect(left.rows[0]).toEqual({ clients: 0, credentials: 0 });
    });
  });
});
