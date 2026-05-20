-- Reconciliation migration: aligns DB schema with prisma/schema.prisma.
-- Replaces a previously broken full-schema 'init' that conflicted with the
-- 39 preceding migrations (P3018 / 42710 'type already exists' on deploy).
-- Generated via: prisma migrate diff --from-migrations <history> --to-schema.

-- CreateEnum
CREATE TYPE "MagicLinkStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NhiIdentityType" AS ENUM ('MACHINE_TO_MACHINE', 'IOT_DEVICE', 'SERVICE', 'AI_AGENT');

-- CreateEnum
CREATE TYPE "NhiLifecycleStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "NhiCredentialType" AS ENUM ('API_KEY', 'CERTIFICATE', 'JWT', 'OAUTH', 'MTLS');

-- DropForeignKey
ALTER TABLE "nhi_audit_logs" DROP CONSTRAINT "nhi_audit_logs_nhi_identity_id_fkey";

-- DropIndex
DROP INDEX "nhi_audit_logs_nhi_identity_id_created_at_idx";

-- DropIndex
DROP INDEX "nhi_audit_logs_realm_id_action_idx";

-- DropIndex
DROP INDEX "nhi_audit_logs_realm_id_created_at_idx";

-- DropIndex
DROP INDEX "nhi_identities_realm_id_identity_type_idx";

-- DropIndex
DROP INDEX "nhi_identities_realm_id_lifecycle_status_idx";

-- DropIndex
DROP INDEX "pending_deletions_user_id_idx";

-- DropIndex
DROP INDEX "upgrade_audit_log_from_version_idx";

-- DropIndex
DROP INDEX "upgrade_audit_log_to_version_idx";

-- DropIndex
DROP INDEX "user_consent_history_user_id_client_id_idx";

-- DropIndex
DROP INDEX "user_consent_history_user_id_created_at_idx";

-- AlterTable
ALTER TABLE "consent_categories" DROP COLUMN "name";

-- AlterTable
ALTER TABLE "consent_policies" DROP COLUMN "policy_text",
DROP COLUMN "required_for_access",
ADD COLUMN     "content" TEXT;

-- AlterTable
ALTER TABLE "nhi_credential_policies" DROP COLUMN "credential_type",
ADD COLUMN     "credential_type" "NhiCredentialType" NOT NULL DEFAULT 'API_KEY';

-- AlterTable
ALTER TABLE "nhi_credentials" DROP COLUMN "credential_type",
ADD COLUMN     "credential_type" "NhiCredentialType" NOT NULL DEFAULT 'API_KEY';

-- AlterTable
ALTER TABLE "nhi_identities" DROP COLUMN "identity_type",
ADD COLUMN     "identity_type" "NhiIdentityType" NOT NULL DEFAULT 'MACHINE_TO_MACHINE',
DROP COLUMN "lifecycle_status",
ADD COLUMN     "lifecycle_status" "NhiLifecycleStatus" NOT NULL DEFAULT 'PROVISIONING',
ALTER COLUMN "metadata" SET NOT NULL;

-- AlterTable
ALTER TABLE "nhi_usage_stats" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "pending_deletions" DROP COLUMN "created_at",
ALTER COLUMN "grace_period_days" DROP DEFAULT;

-- AlterTable
ALTER TABLE "realms" ADD COLUMN     "captcha_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "captcha_provider" TEXT,
ADD COLUMN     "captcha_score_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN     "hcaptcha_secret_key" TEXT,
ADD COLUMN     "hcaptcha_site_key" TEXT,
ADD COLUMN     "magic_link_email_subject" TEXT,
ADD COLUMN     "magic_link_email_template" TEXT,
ADD COLUMN     "magic_link_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "magic_link_expiry_seconds" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "magic_link_rate_limit_per_email" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "magic_link_rate_limit_window_seconds" INTEGER NOT NULL DEFAULT 900,
ADD COLUMN     "otp_expiry_seconds" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "otp_length" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "privacy_policy_url" TEXT,
ADD COLUMN     "recaptcha_secret_key" TEXT,
ADD COLUMN     "recaptcha_site_key" TEXT,
ADD COLUMN     "scim_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scim_group_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "scim_user_autocreate" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sms_from" TEXT,
ADD COLUMN     "sms_max_requests_per_user" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "sms_provider" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "sms_provider_config" JSONB DEFAULT '{}',
ADD COLUMN     "sms_rate_limit_window" INTEGER NOT NULL DEFAULT 900,
ADD COLUMN     "webauthn_user_verification_required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "upgrade_audit_log" DROP COLUMN "checks_failed",
DROP COLUMN "checks_passed",
DROP COLUMN "duration_ms",
DROP COLUMN "error_message",
DROP COLUMN "metadata",
DROP COLUMN "rollback_from_version",
DROP COLUMN "steps_completed",
DROP COLUMN "steps_failed",
ADD COLUMN     "backup_path" TEXT,
ADD COLUMN     "backup_size" TEXT,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "details" JSONB,
ADD COLUMN     "dry_run" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "rollback_triggered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "initiated_by" SET NOT NULL;

-- AlterTable
ALTER TABLE "user_credentials" ADD COLUMN     "phone_number" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone_number" TEXT;

-- AlterTable
ALTER TABLE "webauthn_credentials" DROP COLUMN "backed_up",
ADD COLUMN     "backedUp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "wizard_states" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "magic_link_requests" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "MagicLinkStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_link_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "used_totp_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "used_totp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totp_failure_tracking" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totp_failure_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_failure_tracking" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_failure_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_risk_profiles" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT,
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "risk_level" TEXT NOT NULL DEFAULT 'LOW',
    "trust_score" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "device_posture" JSONB,
    "network_context" JSONB,
    "behavioral_signals" JSONB,
    "step_up_required" BOOLEAN NOT NULL DEFAULT false,
    "step_up_reason" TEXT,
    "step_up_expires_at" TIMESTAMP(3),
    "terminate_session" BOOLEAN NOT NULL DEFAULT false,
    "termination_reason" TEXT,
    "last_evaluated_at" TIMESTAMP(3),
    "next_evaluation_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_risk_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_posture_records" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_fingerprint" TEXT NOT NULL,
    "os_type" TEXT,
    "os_version" TEXT,
    "os_build" TEXT,
    "security_patch_level" TEXT,
    "last_update_date" TIMESTAMP(3),
    "disk_encrypted" BOOLEAN,
    "encryption_type" TEXT,
    "antivirus_enabled" BOOLEAN,
    "antivirus_name" TEXT,
    "firewall_enabled" BOOLEAN,
    "screen_lock_enabled" BOOLEAN NOT NULL DEFAULT false,
    "lock_timeout_seconds" INTEGER,
    "managed_device" BOOLEAN NOT NULL DEFAULT false,
    "mdm_enrollment_id" TEXT,
    "jailbroken" BOOLEAN NOT NULL DEFAULT false,
    "device_trust_tier" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "compliance_status" TEXT,
    "compliance_details" JSONB,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_posture_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_context_records" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "ip_version" INTEGER,
    "geo_country" TEXT,
    "geo_city" TEXT,
    "geo_latitude" DOUBLE PRECISION,
    "geo_longitude" DOUBLE PRECISION,
    "asn" TEXT,
    "isp" TEXT,
    "network_type" TEXT,
    "isp_category" TEXT,
    "is_vpn" BOOLEAN NOT NULL DEFAULT false,
    "is_proxy" BOOLEAN NOT NULL DEFAULT false,
    "is_tor" BOOLEAN NOT NULL DEFAULT false,
    "connection_type" TEXT,
    "mtu" INTEGER,
    "ip_reputation" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "geo_velocity" TEXT,
    "is_datacenter" BOOLEAN NOT NULL DEFAULT false,
    "geo_changed" BOOLEAN NOT NULL DEFAULT false,
    "geo_change_details" JSONB,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_context_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavioral_biometric_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "avg_typing_speed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "typing_variance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_burst_length" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_pointer_speed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pointer_smoothness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_scroll_speed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_session_duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interaction_frequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "model_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "anomaly_threshold" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavioral_biometric_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavioral_samples" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "interaction_type" TEXT NOT NULL,
    "keystroke_durations" JSONB,
    "burst_length" INTEGER,
    "velocity" DOUBLE PRECISION,
    "acceleration" DOUBLE PRECISION,
    "trajectory_angle" DOUBLE PRECISION,
    "curvature" DOUBLE PRECISION,
    "page_url" TEXT,
    "focused_element" TEXT,
    "anomaly_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_anomalous" BOOLEAN NOT NULL DEFAULT false,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavioral_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "continuous_risk_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT,
    "evaluation_type" TEXT NOT NULL,
    "trigger_reason" TEXT,
    "risk_score_before" INTEGER NOT NULL,
    "risk_score_after" INTEGER NOT NULL,
    "risk_level_before" TEXT NOT NULL,
    "risk_level_after" TEXT NOT NULL,
    "trust_score_before" DOUBLE PRECISION NOT NULL,
    "trust_score_after" DOUBLE PRECISION NOT NULL,
    "signals" JSONB NOT NULL,
    "policy_evaluations" JSONB,
    "action" TEXT NOT NULL,
    "action_reason" TEXT,
    "step_up_session_id" TEXT,
    "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "continuous_risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "continuous_risk_policies" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "client_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "conditions" JSONB NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'NO_ACTION',
    "action_data" JSONB,
    "risk_score_contribution" INTEGER NOT NULL DEFAULT 0,
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 300,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "continuous_risk_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_revoked_tokens" (
    "jti" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_revoked_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "sms_delivery_logs" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider_message_id" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_attempts" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_provisioning_tokens" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scopes" TEXT[] DEFAULT ARRAY['urn:scim:schemas:core:1.0:Users', 'urn:scim:schemas:core:1.0:Groups']::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),
    "token_hash" TEXT NOT NULL,

    CONSTRAINT "scim_provisioning_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_attribute_mappings" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "scim_attribute" TEXT NOT NULL,
    "idenplane_attribute" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scim_attribute_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_fields" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "placeholder" TEXT,
    "help_text" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validation_pattern" TEXT,
    "default_value" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registration_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_entries" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "minute_count" INTEGER NOT NULL DEFAULT 0,
    "minute_window_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hour_count" INTEGER NOT NULL DEFAULT 0,
    "hour_window_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "magic_link_requests_token_hash_key" ON "magic_link_requests"("token_hash");

-- CreateIndex
CREATE INDEX "magic_link_requests_realm_id_email_created_at_idx" ON "magic_link_requests"("realm_id", "email", "created_at");

-- CreateIndex
CREATE INDEX "magic_link_requests_realm_id_ip_address_created_at_idx" ON "magic_link_requests"("realm_id", "ip_address", "created_at");

-- CreateIndex
CREATE INDEX "magic_link_requests_user_id_idx" ON "magic_link_requests"("user_id");

-- CreateIndex
CREATE INDEX "magic_link_requests_expires_at_idx" ON "magic_link_requests"("expires_at");

-- CreateIndex
CREATE INDEX "used_totp_codes_user_id_idx" ON "used_totp_codes"("user_id");

-- CreateIndex
CREATE INDEX "used_totp_codes_expires_at_idx" ON "used_totp_codes"("expires_at");

-- CreateIndex
CREATE INDEX "totp_failure_tracking_user_id_failed_at_idx" ON "totp_failure_tracking"("user_id", "failed_at");

-- CreateIndex
CREATE INDEX "totp_failure_tracking_ip_address_failed_at_idx" ON "totp_failure_tracking"("ip_address", "failed_at");

-- CreateIndex
CREATE INDEX "webauthn_failure_tracking_realm_id_user_id_failed_at_idx" ON "webauthn_failure_tracking"("realm_id", "user_id", "failed_at");

-- CreateIndex
CREATE INDEX "webauthn_failure_tracking_ip_address_failed_at_idx" ON "webauthn_failure_tracking"("ip_address", "failed_at");

-- CreateIndex
CREATE UNIQUE INDEX "session_risk_profiles_session_id_key" ON "session_risk_profiles"("session_id");

-- CreateIndex
CREATE INDEX "session_risk_profiles_realm_id_idx" ON "session_risk_profiles"("realm_id");

-- CreateIndex
CREATE INDEX "session_risk_profiles_realm_id_risk_level_idx" ON "session_risk_profiles"("realm_id", "risk_level");

-- CreateIndex
CREATE INDEX "session_risk_profiles_user_id_idx" ON "session_risk_profiles"("user_id");

-- CreateIndex
CREATE INDEX "session_risk_profiles_next_evaluation_at_idx" ON "session_risk_profiles"("next_evaluation_at");

-- CreateIndex
CREATE INDEX "device_posture_records_session_id_idx" ON "device_posture_records"("session_id");

-- CreateIndex
CREATE INDEX "device_posture_records_realm_id_idx" ON "device_posture_records"("realm_id");

-- CreateIndex
CREATE INDEX "device_posture_records_user_id_idx" ON "device_posture_records"("user_id");

-- CreateIndex
CREATE INDEX "device_posture_records_device_fingerprint_idx" ON "device_posture_records"("device_fingerprint");

-- CreateIndex
CREATE INDEX "device_posture_records_realm_id_device_trust_tier_idx" ON "device_posture_records"("realm_id", "device_trust_tier");

-- CreateIndex
CREATE INDEX "network_context_records_session_id_idx" ON "network_context_records"("session_id");

-- CreateIndex
CREATE INDEX "network_context_records_realm_id_idx" ON "network_context_records"("realm_id");

-- CreateIndex
CREATE INDEX "network_context_records_user_id_idx" ON "network_context_records"("user_id");

-- CreateIndex
CREATE INDEX "network_context_records_ip_address_idx" ON "network_context_records"("ip_address");

-- CreateIndex
CREATE INDEX "network_context_records_captured_at_idx" ON "network_context_records"("captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "behavioral_biometric_profiles_user_id_key" ON "behavioral_biometric_profiles"("user_id");

-- CreateIndex
CREATE INDEX "behavioral_biometric_profiles_realm_id_idx" ON "behavioral_biometric_profiles"("realm_id");

-- CreateIndex
CREATE INDEX "behavioral_samples_user_id_collected_at_idx" ON "behavioral_samples"("user_id", "collected_at");

-- CreateIndex
CREATE INDEX "behavioral_samples_session_id_idx" ON "behavioral_samples"("session_id");

-- CreateIndex
CREATE INDEX "behavioral_samples_user_id_interaction_type_idx" ON "behavioral_samples"("user_id", "interaction_type");

-- CreateIndex
CREATE INDEX "continuous_risk_events_session_id_idx" ON "continuous_risk_events"("session_id");

-- CreateIndex
CREATE INDEX "continuous_risk_events_realm_id_idx" ON "continuous_risk_events"("realm_id");

-- CreateIndex
CREATE INDEX "continuous_risk_events_user_id_idx" ON "continuous_risk_events"("user_id");

-- CreateIndex
CREATE INDEX "continuous_risk_events_evaluated_at_idx" ON "continuous_risk_events"("evaluated_at");

-- CreateIndex
CREATE INDEX "continuous_risk_events_realm_id_action_idx" ON "continuous_risk_events"("realm_id", "action");

-- CreateIndex
CREATE INDEX "continuous_risk_policies_realm_id_priority_idx" ON "continuous_risk_policies"("realm_id", "priority");

-- CreateIndex
CREATE INDEX "continuous_risk_policies_realm_id_enabled_idx" ON "continuous_risk_policies"("realm_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "continuous_risk_policies_realm_id_client_id_name_key" ON "continuous_risk_policies"("realm_id", "client_id", "name");

-- CreateIndex
CREATE INDEX "admin_revoked_tokens_expires_at_idx" ON "admin_revoked_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "sms_delivery_logs_realm_id_user_id_created_at_idx" ON "sms_delivery_logs"("realm_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "sms_delivery_logs_realm_id_created_at_idx" ON "sms_delivery_logs"("realm_id", "created_at");

-- CreateIndex
CREATE INDEX "otp_attempts_realm_id_user_id_expires_at_idx" ON "otp_attempts"("realm_id", "user_id", "expires_at");

-- CreateIndex
CREATE INDEX "otp_attempts_realm_id_phone_hash_expires_at_idx" ON "otp_attempts"("realm_id", "phone_hash", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "scim_provisioning_tokens_token_hash_key" ON "scim_provisioning_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "scim_provisioning_tokens_realm_id_idx" ON "scim_provisioning_tokens"("realm_id");

-- CreateIndex
CREATE INDEX "scim_provisioning_tokens_token_hash_idx" ON "scim_provisioning_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "scim_attribute_mappings_realm_id_resourceType_idx" ON "scim_attribute_mappings"("realm_id", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "scim_attribute_mappings_realm_id_resourceType_scim_attribut_key" ON "scim_attribute_mappings"("realm_id", "resourceType", "scim_attribute");

-- CreateIndex
CREATE INDEX "registration_fields_realm_id_idx" ON "registration_fields"("realm_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_fields_realm_id_name_key" ON "registration_fields"("realm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_entries_key_key" ON "rate_limit_entries"("key");

-- CreateIndex
CREATE INDEX "rate_limit_entries_key_idx" ON "rate_limit_entries"("key");

-- CreateIndex
CREATE INDEX "rate_limit_entries_minute_window_start_idx" ON "rate_limit_entries"("minute_window_start");

-- CreateIndex
CREATE INDEX "rate_limit_entries_hour_window_start_idx" ON "rate_limit_entries"("hour_window_start");

-- CreateIndex
CREATE INDEX "authorization_codes_client_id_idx" ON "authorization_codes"("client_id");

-- CreateIndex
CREATE INDEX "nhi_audit_logs_realm_id_idx" ON "nhi_audit_logs"("realm_id");

-- CreateIndex
CREATE INDEX "nhi_audit_logs_nhi_identity_id_idx" ON "nhi_audit_logs"("nhi_identity_id");

-- CreateIndex
CREATE INDEX "nhi_audit_logs_action_idx" ON "nhi_audit_logs"("action");

-- CreateIndex
CREATE INDEX "nhi_credential_policies_realm_id_priority_idx" ON "nhi_credential_policies"("realm_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "nhi_credentials_nhi_identity_id_name_key" ON "nhi_credentials"("nhi_identity_id", "name");

-- CreateIndex
CREATE INDEX "nhi_identities_lifecycle_status_idx" ON "nhi_identities"("lifecycle_status");

-- CreateIndex
CREATE INDEX "password_histories_user_id_idx" ON "password_histories"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "pending_deletions_user_id_key" ON "pending_deletions"("user_id");

-- CreateIndex
CREATE INDEX "service_accounts_realm_id_idx" ON "service_accounts"("realm_id");

-- CreateIndex
CREATE INDEX "upgrade_audit_log_from_version_to_version_idx" ON "upgrade_audit_log"("from_version", "to_version");

-- CreateIndex
CREATE INDEX "user_consent_history_user_id_idx" ON "user_consent_history"("user_id");

-- CreateIndex
CREATE INDEX "user_consent_history_client_id_idx" ON "user_consent_history"("client_id");

-- CreateIndex
CREATE INDEX "user_consent_history_created_at_idx" ON "user_consent_history"("created_at");

-- CreateIndex
CREATE INDEX "users_realm_id_idx" ON "users"("realm_id");

-- AddForeignKey
ALTER TABLE "magic_link_requests" ADD CONSTRAINT "magic_link_requests_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_link_requests" ADD CONSTRAINT "magic_link_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "used_totp_codes" ADD CONSTRAINT "used_totp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_failure_tracking" ADD CONSTRAINT "totp_failure_tracking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_failure_tracking" ADD CONSTRAINT "webauthn_failure_tracking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_failure_tracking" ADD CONSTRAINT "webauthn_failure_tracking_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_risk_assessments" ADD CONSTRAINT "login_risk_assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_login_profiles" ADD CONSTRAINT "user_login_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_risk_profiles" ADD CONSTRAINT "session_risk_profiles_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_risk_profiles" ADD CONSTRAINT "session_risk_profiles_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_risk_profiles" ADD CONSTRAINT "session_risk_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavioral_biometric_profiles" ADD CONSTRAINT "behavioral_biometric_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavioral_biometric_profiles" ADD CONSTRAINT "behavioral_biometric_profiles_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "continuous_risk_policies" ADD CONSTRAINT "continuous_risk_policies_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_delivery_logs" ADD CONSTRAINT "sms_delivery_logs_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_attempts" ADD CONSTRAINT "otp_attempts_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_provisioning_tokens" ADD CONSTRAINT "scim_provisioning_tokens_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_attribute_mappings" ADD CONSTRAINT "scim_attribute_mappings_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_fields" ADD CONSTRAINT "registration_fields_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

