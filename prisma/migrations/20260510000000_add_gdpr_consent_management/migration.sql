-- ──────────────────────────────────────────────────────────────────────────
-- Migration: Feature 009 — GDPR Consent Management UI
-- Phase 1: Database Schema Enhancement
--
-- Creates consent management tables:
--   1. consent_categories - configurable consent categories per realm
--   2. consent_policies - versioned policy text for each category
--   3. user_consent_history - audit trail of consent actions
--   4. pending_deletions - GDPR right to erasure with grace period
-- ──────────────────────────────────────────────────────────────────────────

-- 1. Create consent_categories table
CREATE TABLE "consent_categories" (
    "id"                    TEXT         NOT NULL,
    "realm_id"              TEXT         NOT NULL,
    "name"                  TEXT         NOT NULL,
    "display_name"          TEXT         NOT NULL,
    "description"           TEXT,
    "key"                   TEXT         NOT NULL,
    "required"              BOOLEAN      NOT NULL DEFAULT false,
    "configurable_by_user"   BOOLEAN      NOT NULL DEFAULT true,
    "show_in_account_portal" BOOLEAN     NOT NULL DEFAULT true,
    "order"                 INTEGER      NOT NULL DEFAULT 0,
    "enabled"               BOOLEAN      NOT NULL DEFAULT true,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_categories_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: key must be unique within a realm
CREATE UNIQUE INDEX "consent_categories_realm_id_key_key"
    ON "consent_categories"("realm_id", "key");

-- Index on realm_id for listing categories by realm
CREATE INDEX "consent_categories_realm_id_idx"
    ON "consent_categories"("realm_id");

-- FK: consent_categories.realm_id → realms.id (cascade delete)
ALTER TABLE "consent_categories"
    ADD CONSTRAINT "consent_categories_realm_id_fkey"
    FOREIGN KEY ("realm_id")
    REFERENCES "realms"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- 2. Create consent_policies table
CREATE TABLE "consent_policies" (
    "id"                    TEXT         NOT NULL,
    "category_id"            TEXT         NOT NULL,
    "version"               TEXT         NOT NULL,
    "policy_text"           TEXT         NOT NULL,
    "is_active"             BOOLEAN      NOT NULL DEFAULT false,
    "required_for_access"   BOOLEAN      NOT NULL DEFAULT true,
    "published_at"          TIMESTAMP(3),
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_policies_pkey" PRIMARY KEY ("id")
);

-- Index on category_id for listing policies by category
CREATE INDEX "consent_policies_category_id_idx"
    ON "consent_policies"("category_id");

-- Index for finding active policy per category
CREATE INDEX "consent_policies_category_id_is_active_idx"
    ON "consent_policies"("category_id", "is_active")
    WHERE "is_active" = true;

-- FK: consent_policies.category_id → consent_categories.id (cascade delete)
ALTER TABLE "consent_policies"
    ADD CONSTRAINT "consent_policies_category_id_fkey"
    FOREIGN KEY ("category_id")
    REFERENCES "consent_categories"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- 3. Create user_consent_history table (audit trail)
CREATE TABLE "user_consent_history" (
    "id"                    TEXT         NOT NULL,
    "user_id"               TEXT         NOT NULL,
    "client_id"             TEXT         NOT NULL,
    "action"                TEXT         NOT NULL,
    "scopes"                TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "policy_version"        TEXT,
    "ip_address"            TEXT,
    "user_agent"            TEXT,
    "metadata"              JSONB,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consent_history_pkey" PRIMARY KEY ("id")
);

-- Index on user_id and created_at for listing history by user
CREATE INDEX "user_consent_history_user_id_created_at_idx"
    ON "user_consent_history"("user_id", "created_at" DESC);

-- Index on user_id and client_id for user-client specific history
CREATE INDEX "user_consent_history_user_id_client_id_idx"
    ON "user_consent_history"("user_id", "client_id");

-- FK: user_consent_history.user_id → users.id (cascade delete)
ALTER TABLE "user_consent_history"
    ADD CONSTRAINT "user_consent_history_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- FK: user_consent_history.client_id → clients.id (cascade delete)
ALTER TABLE "user_consent_history"
    ADD CONSTRAINT "user_consent_history_client_id_fkey"
    FOREIGN KEY ("client_id")
    REFERENCES "clients"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- 4. Create pending_deletions table (GDPR right to erasure)
CREATE TABLE "pending_deletions" (
    "id"                    TEXT         NOT NULL,
    "user_id"               TEXT         NOT NULL,
    "requested_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_at"          TIMESTAMP(3) NOT NULL,
    "grace_period_days"     INTEGER      NOT NULL DEFAULT 14,
    "status"                TEXT         NOT NULL DEFAULT 'pending',
    "export_status"         TEXT,
    "export_requested_at"   TIMESTAMP(3),
    "export_generated_at"   TIMESTAMP(3),
    "export_url"            TEXT,
    "cancelled_at"          TIMESTAMP(3),
    "cancelled_by"          TEXT,
    "completed_at"          TIMESTAMP(3),
    "ip_address"            TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_deletions_pkey" PRIMARY KEY ("id")
);

-- Index on user_id for looking up pending deletion by user
CREATE INDEX "pending_deletions_user_id_idx"
    ON "pending_deletions"("user_id");

-- Index on status for listing by status
CREATE INDEX "pending_deletions_status_idx"
    ON "pending_deletions"("status");

-- Index on scheduled_at for cron job processing
CREATE INDEX "pending_deletions_scheduled_at_idx"
    ON "pending_deletions"("scheduled_at");

-- FK: pending_deletions.user_id → users.id (cascade delete)
ALTER TABLE "pending_deletions"
    ADD CONSTRAINT "pending_deletions_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- Add foreign key for cancelled_by (self-reference to users)
-- Note: cancelled_by can be null, so we only add constraint when not null
-- This is handled at application level to avoid FK constraint issues