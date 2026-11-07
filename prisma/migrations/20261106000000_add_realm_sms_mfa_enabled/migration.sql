-- Per-realm SMS MFA switch. The admin UI has always sent `smsMfaEnabled`, but
-- the column never existed, so the SMS settings could not be saved at all.
-- Purely additive with a false default: no existing realm changes behaviour.

-- AlterTable
ALTER TABLE "realms" ADD COLUMN "sms_mfa_enabled" BOOLEAN NOT NULL DEFAULT false;
