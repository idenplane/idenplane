-- Client secrets are stored hashed. The setup wizard and the Authentik and
-- Zitadel importers wrote some as plaintext; those clients could not
-- authenticate (the Argon2 check threw on a value that is not a hash), and
-- the plaintext sat in the database. Hash every such value in the fast format
-- the server reads as `sha256$<hex>`. A secret that is not a generated one is
-- moved to Argon2 by the server the first time it is presented.
UPDATE "clients"
SET "client_secret" = 'sha256$' || encode(sha256(convert_to("client_secret", 'UTF8')), 'hex')
WHERE "client_secret" IS NOT NULL
  AND "client_secret" <> ''
  AND "client_secret" NOT LIKE '$argon2%'
  AND "client_secret" NOT LIKE 'sha256$%';

-- The wizard also kept the plaintext secret in its own state. It is shown
-- once when the client is created and is never needed again.
UPDATE "wizard_states" SET "client_secret" = NULL WHERE "client_secret" IS NOT NULL;
