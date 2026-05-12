-- CreateTable: nhi_identities — Non-Human Identity entities (devices, AI agents, bots, M2M)
CREATE TABLE "nhi_identities" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "identity_type" TEXT NOT NULL DEFAULT 'MACHINE_TO_MACHINE',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    -- Lifecycle management
    "lifecycle_status" TEXT NOT NULL DEFAULT 'PROVISIONING',
    "suspended_at" TIMESTAMP(3),
    "decommissioned_at" TIMESTAMP(3),

    -- Certificate-based auth (for IoT/mTLS)
    "certificate_subject" TEXT,
    "certificate_fingerprint" TEXT,
    "certificate_not_before" TIMESTAMP(3),
    "certificate_not_after" TIMESTAMP(3),

    -- AI agent specific
    "agent_purpose" TEXT,
    "permission_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- Metadata
    "metadata" JSONB DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nhi_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable: nhi_credentials — Credentials for NHI (API keys, certificates, JWTs, mTLS)
CREATE TABLE "nhi_credentials" (
    "id" TEXT NOT NULL,
    "nhi_identity_id" TEXT NOT NULL,
    "credential_type" TEXT NOT NULL DEFAULT 'API_KEY',
    "name" TEXT NOT NULL,
    "key_prefix" TEXT,
    "key_hash" TEXT,

    -- Certificate fields
    "certificate_pem" TEXT,
    "certificate_chain" TEXT,
    "private_key_pem" TEXT,

    -- JWT fields
    "jwt_signing_algorithm" TEXT,
    "jwt_issuer" TEXT,
    "jwt_audience" TEXT,

    -- Expiration and rotation
    "expires_at" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "rotation_required" BOOLEAN NOT NULL DEFAULT false,

    -- Status
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),

    -- Usage tracking
    "last_used_at" TIMESTAMP(3),
    "request_count" INTEGER NOT NULL DEFAULT 0,

    -- IP restrictions
    "allowed_ip_ranges" TEXT[] DEFAULT ARRAY[]::TEXT[],

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nhi_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable: nhi_credential_policies — Policies for credential management
CREATE TABLE "nhi_credential_policies" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,

    -- Credential type this policy applies to
    "credential_type" TEXT NOT NULL DEFAULT 'API_KEY',

    -- Rotation settings
    "rotation_interval_days" INTEGER NOT NULL DEFAULT 90,
    "rotation_before_days" INTEGER NOT NULL DEFAULT 7,
    "auto_rotate" BOOLEAN NOT NULL DEFAULT false,

    -- Expiration settings
    "max_credential_age_days" INTEGER NOT NULL DEFAULT 365,

    -- Usage limits
    "max_requests_per_day" INTEGER,
    "max_requests_per_month" INTEGER,
    "rate_limit_per_minute" INTEGER,

    -- Security settings
    "require_certificate" BOOLEAN NOT NULL DEFAULT false,
    "require_ip_restriction" BOOLEAN NOT NULL DEFAULT false,
    "require_audit_logging" BOOLEAN NOT NULL DEFAULT true,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nhi_credential_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable: nhi_audit_logs — Audit trail for NHI operations
CREATE TABLE "nhi_audit_logs" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "nhi_identity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "credential_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_code" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nhi_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: nhi_usage_stats — Usage statistics for NHI
CREATE TABLE "nhi_usage_stats" (
    "id" TEXT NOT NULL,
    "nhi_identity_id" TEXT NOT NULL,
    "total_requests" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "last_active_at" TIMESTAMP(3),
    "last_successful_at" TIMESTAMP(3),
    "last_failed_at" TIMESTAMP(3),

    -- Credential age tracking
    "oldest_credential_age_days" INTEGER,
    "newest_credential_age_days" INTEGER,
    "credentials_expiring_soon" INTEGER NOT NULL DEFAULT 0,

    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nhi_usage_stats_pkey" PRIMARY KEY ("id")
);

-- Create indexes for nhi_identities
CREATE UNIQUE INDEX "nhi_identities_realm_id_name_key" ON "nhi_identities"("realm_id", "name");
CREATE INDEX "nhi_identities_realm_id_idx" ON "nhi_identities"("realm_id");
CREATE INDEX "nhi_identities_realm_id_identity_type_idx" ON "nhi_identities"("realm_id", "identity_type");
CREATE INDEX "nhi_identities_realm_id_lifecycle_status_idx" ON "nhi_identities"("realm_id", "lifecycle_status");

-- Create indexes for nhi_credentials
CREATE INDEX "nhi_credentials_nhi_identity_id_idx" ON "nhi_credentials"("nhi_identity_id");
CREATE INDEX "nhi_credentials_key_prefix_idx" ON "nhi_credentials"("key_prefix");
CREATE INDEX "nhi_credentials_expires_at_idx" ON "nhi_credentials"("expires_at");

-- Create indexes for nhi_credential_policies
CREATE UNIQUE INDEX "nhi_credential_policies_realm_id_name_key" ON "nhi_credential_policies"("realm_id", "name");
CREATE INDEX "nhi_credential_policies_realm_id_idx" ON "nhi_credential_policies"("realm_id");

-- Create indexes for nhi_audit_logs
CREATE INDEX "nhi_audit_logs_realm_id_created_at_idx" ON "nhi_audit_logs"("realm_id", "created_at");
CREATE INDEX "nhi_audit_logs_nhi_identity_id_created_at_idx" ON "nhi_audit_logs"("nhi_identity_id", "created_at");
CREATE INDEX "nhi_audit_logs_realm_id_action_idx" ON "nhi_audit_logs"("realm_id", "action");
CREATE INDEX "nhi_audit_logs_created_at_idx" ON "nhi_audit_logs"("created_at");

-- Add foreign key for nhi_identities
ALTER TABLE "nhi_identities"
    ADD CONSTRAINT "nhi_identities_realm_id_fkey"
    FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add foreign key for nhi_credentials
ALTER TABLE "nhi_credentials"
    ADD CONSTRAINT "nhi_credentials_nhi_identity_id_fkey"
    FOREIGN KEY ("nhi_identity_id") REFERENCES "nhi_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add foreign key for nhi_credential_policies
ALTER TABLE "nhi_credential_policies"
    ADD CONSTRAINT "nhi_credential_policies_realm_id_fkey"
    FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add foreign keys for nhi_audit_logs
ALTER TABLE "nhi_audit_logs"
    ADD CONSTRAINT "nhi_audit_logs_realm_id_fkey"
    FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "nhi_audit_logs"
    ADD CONSTRAINT "nhi_audit_logs_nhi_identity_id_fkey"
    FOREIGN KEY ("nhi_identity_id") REFERENCES "nhi_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add foreign key for nhi_usage_stats
ALTER TABLE "nhi_usage_stats"
    ADD CONSTRAINT "nhi_usage_stats_nhi_identity_id_fkey"
    FOREIGN KEY ("nhi_identity_id") REFERENCES "nhi_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create unique constraint for nhi_usage_stats
ALTER TABLE "nhi_usage_stats"
    ADD CONSTRAINT "nhi_usage_stats_nhi_identity_id_key"
    UNIQUE ("nhi_identity_id");