-- Secrets at rest: one row that proves the configured WEBHOOK_SECRET_KEY and
-- WEBHOOK_ENCRYPTION_SALT are the ones stored secrets were encrypted with.
--
-- The existing plaintext secrets are NOT encrypted here: SQL cannot use the
-- application key. SecretsAtRestService does it on the first start of this
-- version, under an advisory lock (src/secrets-at-rest/).

-- CreateTable
CREATE TABLE "encryption_key_check" (
    "id" TEXT NOT NULL,
    "key_check" TEXT NOT NULL,
    "sweep_version" INTEGER NOT NULL DEFAULT 0,
    "swept_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encryption_key_check_pkey" PRIMARY KEY ("id")
);
