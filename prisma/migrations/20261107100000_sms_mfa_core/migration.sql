-- SMS MFA core. otp_attempts was never written by a running server (the old
-- service was not registered in any module), so it is safe to clear before
-- reshaping it.
DELETE FROM "otp_attempts";

DROP INDEX IF EXISTS "otp_attempts_realm_id_user_id_expires_at_idx";
DROP INDEX IF EXISTS "otp_attempts_realm_id_phone_hash_expires_at_idx";

ALTER TABLE "otp_attempts"
  DROP COLUMN "verified",
  DROP COLUMN "failed_attempts",
  DROP COLUMN "verified_at",
  ADD COLUMN "purpose" TEXT NOT NULL,
  ADD COLUMN "binding_hash" TEXT NOT NULL,
  ADD COLUMN "phone_encrypted" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "send_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "otp_attempts_purpose_binding_hash_key" ON "otp_attempts"("purpose", "binding_hash");
CREATE INDEX "otp_attempts_realm_id_user_id_idx" ON "otp_attempts"("realm_id", "user_id");
CREATE INDEX "otp_attempts_expires_at_idx" ON "otp_attempts"("expires_at");

ALTER TABLE "sms_delivery_logs" ADD COLUMN "ip_hash" TEXT;
CREATE INDEX "sms_delivery_logs_realm_id_phone_hash_created_at_idx" ON "sms_delivery_logs"("realm_id", "phone_hash", "created_at");
CREATE INDEX "sms_delivery_logs_realm_id_ip_hash_created_at_idx" ON "sms_delivery_logs"("realm_id", "ip_hash", "created_at");

ALTER TABLE "pending_actions" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
