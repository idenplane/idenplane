-- Organization invitations store only a SHA-256 of their token.
--
-- Since 0.2.0 (2026-03-26) the "token" column already held sha256(token) as
-- hex, so those values are kept as they are: hashing them again would break
-- every pending invitation. The column is renamed to say what it holds.
--
-- Rows created before that release (0.1.0) hold the raw token. A raw token
-- and a hash are both 64 hex characters and cannot be told apart, so rows
-- are told apart by age: an invitation lives 72 hours, so every row created
-- before 2026-03-27 has expired or been used, and hashing it can break
-- nothing. Its raw token is replaced by its hash, so no usable token
-- (only expired or used ones) is left anywhere in the table.

-- AlterTable: keep the hashes, rename the column and its unique index.
ALTER TABLE "organization_invitations" RENAME COLUMN "token" TO "token_hash";
ALTER INDEX "organization_invitations_token_key" RENAME TO "organization_invitations_token_hash_key";

-- Backfill: the raw tokens of the oldest rows become their hashes
-- (hex of SHA-256 over the UTF-8 bytes, as CryptoService.sha256 computes).
UPDATE "organization_invitations"
   SET "token_hash" = encode(sha256(convert_to("token_hash", 'UTF8')), 'hex')
 WHERE "created_at" < TIMESTAMP '2026-03-27 00:00:00';
