-- RFC 8705 NHI binding: an NHI identity authenticates at the realm's token
-- endpoint as an NHI-backed OAuth client, with its own certificates.
--
-- Hand-reviewed. Beyond what Prisma generates:
--   * nhi_credentials.realm_id is added nullable, backfilled from the
--     identity, then made NOT NULL;
--   * cert_thumbprint_s256 is backfilled in SQL from the stored PEM (first
--     CERTIFICATE block); a PEM that cannot be read leaves NULL instead of
--     failing the migration. Backfilled rows keep tls_auth_mode NULL, so they
--     never authenticate (fail closed) until an admin registers the
--     certificate as a new credential with a mode;
--   * triggers keep a client and its NHI identity, and a credential and its
--     identity, in the same realm.

-- CreateEnum
CREATE TYPE "NhiTlsAuthMode" AS ENUM ('SELF_SIGNED', 'PKI');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "nhi_identity_id" TEXT;

-- AlterTable
ALTER TABLE "nhi_credential_policies" ADD COLUMN     "rotation_overlap_seconds" INTEGER NOT NULL DEFAULT 86400;

-- AlterTable (realm_id is made NOT NULL after the backfill below)
ALTER TABLE "nhi_credentials" ADD COLUMN     "cert_issuer" TEXT,
ADD COLUMN     "cert_not_after" TIMESTAMP(3),
ADD COLUMN     "cert_not_before" TIMESTAMP(3),
ADD COLUMN     "cert_serial_number" TEXT,
ADD COLUMN     "cert_subject" TEXT,
ADD COLUMN     "cert_thumbprint_s256" TEXT,
ADD COLUMN     "realm_id" TEXT,
ADD COLUMN     "rotation_grace_until" TIMESTAMP(3),
ADD COLUMN     "superseded_by_id" TEXT,
ADD COLUMN     "tls_auth_mode" "NhiTlsAuthMode",
ADD COLUMN     "tls_client_auth_san_dns" TEXT,
ADD COLUMN     "tls_client_auth_san_email" TEXT,
ADD COLUMN     "tls_client_auth_san_ip" TEXT,
ADD COLUMN     "tls_client_auth_san_uri" TEXT,
ADD COLUMN     "tls_client_auth_subject_dn" TEXT;

-- Backfill: a credential's realm is its identity's realm.
UPDATE "nhi_credentials" c
   SET "realm_id" = i."realm_id"
  FROM "nhi_identities" i
 WHERE i."id" = c."nhi_identity_id";

ALTER TABLE "nhi_credentials" ALTER COLUMN "realm_id" SET NOT NULL;

-- RFC 8705 x5t#S256 of the first CERTIFICATE block of a PEM: base64url of
-- the SHA-256 of the DER, without padding (as computeX5tS256 in
-- src/mtls/client-certificate.source.ts). NULL when there is no readable
-- block or the block is not a DER SEQUENCE. Kept after the migration: the
-- migration test checks it against the application's computation.
CREATE OR REPLACE FUNCTION idenplane_pem_x5t_s256(pem text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  body text;
  der bytea;
BEGIN
  -- The character class cannot contain '-', so the match ends at the first
  -- END marker: only the first block is read, never a chain or a key.
  body := substring(pem FROM '-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=[:space:]]+)-----END CERTIFICATE-----');
  IF body IS NULL THEN
    RETURN NULL;
  END IF;
  der := decode(regexp_replace(body, '[[:space:]]+', '', 'g'), 'base64');
  -- An X.509 certificate is a DER SEQUENCE (0x30) of some size; anything
  -- else is not hashed.
  IF length(der) < 64 OR get_byte(der, 0) <> 48 THEN
    RETURN NULL;
  END IF;
  -- encode() wraps base64 at 76 characters; a 32-byte digest never wraps,
  -- but newlines are dropped anyway.
  RETURN rtrim(translate(encode(sha256(der), 'base64'), E'+/\n', '-_'), '=');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Backfill: the canonical thumbprint of every stored certificate.
UPDATE "nhi_credentials"
   SET "cert_thumbprint_s256" = idenplane_pem_x5t_s256("certificate_pem")
 WHERE "certificate_pem" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "clients_nhi_identity_id_key" ON "clients"("nhi_identity_id");

-- CreateIndex
CREATE UNIQUE INDEX "nhi_credentials_superseded_by_id_key" ON "nhi_credentials"("superseded_by_id");

-- CreateIndex
CREATE INDEX "nhi_credentials_realm_id_cert_thumbprint_s256_idx" ON "nhi_credentials"("realm_id", "cert_thumbprint_s256");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_nhi_identity_id_fkey" FOREIGN KEY ("nhi_identity_id") REFERENCES "nhi_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nhi_credentials" ADD CONSTRAINT "nhi_credentials_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nhi_credentials" ADD CONSTRAINT "nhi_credentials_superseded_by_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "nhi_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Same-realm triggers ─────────────────────────────────────────────────────
--
-- The identity row is read FOR SHARE, which conflicts with the row lock an
-- UPDATE of nhi_identities.realm_id takes, so a link and a concurrent realm
-- change of the identity cannot both commit. A missing identity is left to
-- the foreign key. SQLSTATE 23514 (check_violation).

CREATE OR REPLACE FUNCTION idenplane_client_nhi_same_realm() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  identity_realm text;
BEGIN
  IF NEW."nhi_identity_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "realm_id" INTO identity_realm
    FROM "nhi_identities" WHERE "id" = NEW."nhi_identity_id" FOR SHARE;
  IF FOUND AND identity_realm IS DISTINCT FROM NEW."realm_id" THEN
    RAISE EXCEPTION 'client % cannot be bound to NHI identity % of another realm',
      NEW."id", NEW."nhi_identity_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_nhi_identity_same_realm
  BEFORE INSERT OR UPDATE OF "nhi_identity_id", "realm_id" ON "clients"
  FOR EACH ROW EXECUTE FUNCTION idenplane_client_nhi_same_realm();

CREATE OR REPLACE FUNCTION idenplane_nhi_credential_same_realm() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  identity_realm text;
BEGIN
  SELECT "realm_id" INTO identity_realm
    FROM "nhi_identities" WHERE "id" = NEW."nhi_identity_id" FOR SHARE;
  IF FOUND AND identity_realm IS DISTINCT FROM NEW."realm_id" THEN
    RAISE EXCEPTION 'NHI credential % must be in the realm of its identity %',
      NEW."id", NEW."nhi_identity_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nhi_credentials_same_realm
  BEFORE INSERT OR UPDATE OF "realm_id", "nhi_identity_id" ON "nhi_credentials"
  FOR EACH ROW EXECUTE FUNCTION idenplane_nhi_credential_same_realm();

-- An identity that has a client or credentials cannot move to another realm:
-- both would be left in the old one.
CREATE OR REPLACE FUNCTION idenplane_nhi_identity_realm_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."realm_id" IS DISTINCT FROM OLD."realm_id" AND (
       EXISTS (SELECT 1 FROM "clients" WHERE "nhi_identity_id" = NEW."id")
    OR EXISTS (SELECT 1 FROM "nhi_credentials" WHERE "nhi_identity_id" = NEW."id")
  ) THEN
    RAISE EXCEPTION 'NHI identity % has a client or credentials; it cannot change realm',
      NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nhi_identities_realm_change
  BEFORE UPDATE OF "realm_id" ON "nhi_identities"
  FOR EACH ROW EXECUTE FUNCTION idenplane_nhi_identity_realm_change();
