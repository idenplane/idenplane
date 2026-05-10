-- Create wizard_state table for persisting wizard progress
CREATE TABLE "wizard_states" (
    "id" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "admin_username" TEXT,
    "admin_email" TEXT,
    "admin_password_hash" TEXT,
    "realm_name" TEXT,
    "realm_display_name" TEXT,
    "smtp_config" JSONB,
    "client_id" TEXT,
    "client_secret" TEXT,
    "redirect_uris" TEXT[] NOT NULL DEFAULT '{}',
    "sdk_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    PRIMARY KEY ("id")
);