-- SCIM externalId and profile attributes (0.13.0).
--
-- users.scim_external_id and groups.scim_external_id keep the SCIM client's
-- own id for a resource (RFC 7643 §3.1 externalId), so `externalId eq "..."`
-- filters work and the value is returned. users.scim_profile keeps the SCIM
-- User attributes that have no column (displayName, title, phoneNumbers,
-- addresses, the enterprise extension, ...), so SCIM returns what the client
-- wrote. All three are NULL for existing rows; no existing data changes.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "scim_external_id" TEXT,
ADD COLUMN "scim_profile" JSONB;

-- AlterTable
ALTER TABLE "groups" ADD COLUMN "scim_external_id" TEXT;

-- CreateIndex
CREATE INDEX "users_realm_id_scim_external_id_idx" ON "users"("realm_id", "scim_external_id");

-- CreateIndex
CREATE INDEX "groups_realm_id_scim_external_id_idx" ON "groups"("realm_id", "scim_external_id");
