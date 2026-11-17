-- Password history keeps the algorithm of a migrated hash (0.13.0).
--
-- A user imported from Keycloak, Auth0, Authentik or Zitadel keeps their
-- imported hash, which was never written to password_histories. From 0.13.0
-- the outgoing hash is recorded when a password is changed, if it is not
-- already the newest history entry, so the imported password stays "used"
-- for the next changes too. Hashes imported before 0.11.0 are unlabelled
-- PBKDF2 rows ("iterations$salt$hash") that can only be checked with the
-- user's password_algorithm; this column keeps it. Existing rows are new
-- hashes written by Idenplane itself (self-describing) and stay null.

-- AlterTable
ALTER TABLE "password_histories" ADD COLUMN "password_algorithm" TEXT;
