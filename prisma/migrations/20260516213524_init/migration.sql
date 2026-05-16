-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('CONFIDENTIAL', 'PUBLIC');

-- CreateEnum
CREATE TYPE "MagicLinkStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NhiIdentityType" AS ENUM ('MACHINE_TO_MACHINE', 'IOT_DEVICE', 'SERVICE', 'AI_AGENT');

-- CreateEnum
CREATE TYPE "NhiLifecycleStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "NhiCredentialType" AS ENUM ('API_KEY', 'CERTIFICATE', 'JWT', 'OAUTH', 'MTLS');

-- CreateTable
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
    "redirect_uris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sdk_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wizard_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "realms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "access_token_lifespan" INTEGER NOT NULL DEFAULT 300,
    "refresh_token_lifespan" INTEGER NOT NULL DEFAULT 1800,
    "smtp_host" TEXT,
    "smtp_port" INTEGER DEFAULT 587,
    "smtp_user" TEXT,
    "smtp_password" TEXT,
    "smtp_from" TEXT,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
    "magic_link_enabled" BOOLEAN NOT NULL DEFAULT false,
    "magic_link_expiry_seconds" INTEGER NOT NULL DEFAULT 300,
    "magic_link_rate_limit_per_email" INTEGER NOT NULL DEFAULT 5,
    "magic_link_rate_limit_window_seconds" INTEGER NOT NULL DEFAULT 900,
    "magic_link_email_subject" TEXT,
    "magic_link_email_template" TEXT,
    "password_min_length" INTEGER NOT NULL DEFAULT 8,
    "password_require_uppercase" BOOLEAN NOT NULL DEFAULT false,
    "password_require_lowercase" BOOLEAN NOT NULL DEFAULT false,
    "password_require_digits" BOOLEAN NOT NULL DEFAULT false,
    "password_require_special_chars" BOOLEAN NOT NULL DEFAULT false,
    "password_history_count" INTEGER NOT NULL DEFAULT 0,
    "password_max_age_days" INTEGER NOT NULL DEFAULT 0,
    "brute_force_enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_login_failures" INTEGER NOT NULL DEFAULT 5,
    "lockout_duration" INTEGER NOT NULL DEFAULT 900,
    "failure_reset_time" INTEGER NOT NULL DEFAULT 600,
    "permanent_lockout_after" INTEGER NOT NULL DEFAULT 0,
    "registration_allowed" BOOLEAN NOT NULL DEFAULT true,
    "registration_approval_required" BOOLEAN NOT NULL DEFAULT false,
    "allowed_email_domains" TEXT[],
    "terms_of_service_url" TEXT,
    "privacy_policy_url" TEXT,
    "captcha_enabled" BOOLEAN NOT NULL DEFAULT false,
    "captcha_provider" TEXT,
    "recaptcha_site_key" TEXT,
    "recaptcha_secret_key" TEXT,
    "hcaptcha_site_key" TEXT,
    "hcaptcha_secret_key" TEXT,
    "captcha_score_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "require_email_verification" BOOLEAN NOT NULL DEFAULT false,
    "mfa_required" BOOLEAN NOT NULL DEFAULT false,
    "webauthn_enabled" BOOLEAN NOT NULL DEFAULT false,
    "webauthn_rp_name" TEXT,
    "webauthn_rp_id" TEXT,
    "webauthn_user_verification_required" BOOLEAN NOT NULL DEFAULT false,
    "sms_provider" TEXT NOT NULL DEFAULT 'none',
    "sms_provider_config" JSONB DEFAULT '{}',
    "sms_from" TEXT,
    "otp_length" INTEGER NOT NULL DEFAULT 6,
    "otp_expiry_seconds" INTEGER NOT NULL DEFAULT 300,
    "sms_max_requests_per_user" INTEGER NOT NULL DEFAULT 3,
    "sms_rate_limit_window" INTEGER NOT NULL DEFAULT 900,
    "offline_token_lifespan" INTEGER NOT NULL DEFAULT 2592000,
    "impersonation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "impersonation_max_duration" INTEGER NOT NULL DEFAULT 1800,
    "events_enabled" BOOLEAN NOT NULL DEFAULT false,
    "events_expiration" INTEGER NOT NULL DEFAULT 604800,
    "admin_events_enabled" BOOLEAN NOT NULL DEFAULT false,
    "login_event_retention_days" INTEGER NOT NULL DEFAULT 30,
    "admin_event_retention_days" INTEGER NOT NULL DEFAULT 90,
    "rate_limit_enabled" BOOLEAN NOT NULL DEFAULT false,
    "client_rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
    "client_rate_limit_per_hour" INTEGER NOT NULL DEFAULT 1000,
    "user_rate_limit_per_minute" INTEGER NOT NULL DEFAULT 30,
    "user_rate_limit_per_hour" INTEGER NOT NULL DEFAULT 500,
    "ip_rate_limit_per_minute" INTEGER NOT NULL DEFAULT 20,
    "ip_rate_limit_per_hour" INTEGER NOT NULL DEFAULT 200,
    "theme_name" VARCHAR(50) NOT NULL DEFAULT 'authme',
    "theme" JSONB DEFAULT '{}',
    "login_theme" VARCHAR(50) NOT NULL DEFAULT 'authme',
    "account_theme" VARCHAR(50) NOT NULL DEFAULT 'authme',
    "email_theme" VARCHAR(50) NOT NULL DEFAULT 'authme',
    "default_locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "supported_locales" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "max_sessions_per_user" INTEGER NOT NULL DEFAULT 10,
    "adaptive_auth_enabled" BOOLEAN NOT NULL DEFAULT false,
    "risk_threshold_step_up" INTEGER NOT NULL DEFAULT 50,
    "risk_threshold_block" INTEGER NOT NULL DEFAULT 80,
    "scim_enabled" BOOLEAN NOT NULL DEFAULT false,
    "scim_user_autocreate" BOOLEAN NOT NULL DEFAULT true,
    "scim_group_sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "deletion_grace_period_days" INTEGER NOT NULL DEFAULT 14,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "realms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "first_name" TEXT,
    "last_name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "password_hash" TEXT,
    "password_algorithm" TEXT NOT NULL DEFAULT 'argon2',
    "federation_link" TEXT,
    "phone_number" TEXT,
    "password_changed_at" TIMESTAMP(3),
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT,
    "client_type" "ClientType" NOT NULL DEFAULT 'CONFIDENTIAL',
    "name" TEXT,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "require_consent" BOOLEAN NOT NULL DEFAULT false,
    "redirect_uris" TEXT[],
    "web_origins" TEXT[],
    "grant_types" TEXT[] DEFAULT ARRAY['authorization_code']::TEXT[],
    "backchannel_logout_uri" TEXT,
    "backchannel_logout_session_required" BOOLEAN NOT NULL DEFAULT true,
    "required_acr" TEXT,
    "step_up_cache_duration" INTEGER NOT NULL DEFAULT 900,
    "service_account_user_id" TEXT,
    "auth_flow_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "client_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL DEFAULT '',
    "client_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scope" TEXT,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "is_offline" BOOLEAN NOT NULL DEFAULT false,
    "client_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scope" TEXT,
    "code_challenge" TEXT,
    "code_challenge_method" TEXT,
    "nonce" TEXT,
    "acr_values" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authorization_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "realm_signing_keys" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'RS256',
    "public_key" TEXT NOT NULL,
    "private_key" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realm_signing_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_up_records" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "acr_level" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "step_up_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "scopes" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_groups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_roles" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "password_histories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_failures" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT,
    "ip_address" TEXT,
    "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'totp',
    "secret_key" TEXT NOT NULL,
    "phone_number" TEXT,
    "algorithm" TEXT NOT NULL DEFAULT 'SHA1',
    "digits" INTEGER NOT NULL DEFAULT 6,
    "period" INTEGER NOT NULL DEFAULT 30,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "device_type" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "friendly_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_providers" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "display_name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "provider_type" TEXT NOT NULL DEFAULT 'oidc',
    "idp_client_id" TEXT NOT NULL,
    "idp_client_secret" TEXT NOT NULL,
    "authorization_url" TEXT NOT NULL,
    "token_url" TEXT NOT NULL,
    "userinfo_url" TEXT,
    "jwks_url" TEXT,
    "issuer" TEXT,
    "default_scopes" TEXT NOT NULL DEFAULT 'openid email profile',
    "trust_email" BOOLEAN NOT NULL DEFAULT false,
    "link_only" BOOLEAN NOT NULL DEFAULT false,
    "sync_user_profile" BOOLEAN NOT NULL DEFAULT true,
    "saml_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "federated_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "identity_provider_id" TEXT NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "external_username" TEXT,
    "external_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "federated_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saml_service_providers" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "acs_url" TEXT NOT NULL,
    "slo_url" TEXT,
    "certificate" TEXT,
    "name_id_format" TEXT NOT NULL DEFAULT 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    "sign_assertions" BOOLEAN NOT NULL DEFAULT true,
    "sign_responses" BOOLEAN NOT NULL DEFAULT true,
    "attribute_statements" JSONB NOT NULL DEFAULT '{}',
    "valid_redirect_uris" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saml_service_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_scopes" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "protocol" TEXT NOT NULL DEFAULT 'openid-connect',
    "built_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_mappers" (
    "id" TEXT NOT NULL,
    "client_scope_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'openid-connect',
    "mapper_type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "protocol_mappers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_default_scopes" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_scope_id" TEXT NOT NULL,

    CONSTRAINT "client_default_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_optional_scopes" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_scope_id" TEXT NOT NULL,

    CONSTRAINT "client_optional_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_codes" (
    "id" TEXT NOT NULL,
    "device_code" TEXT NOT NULL,
    "user_code" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "scope" TEXT,
    "user_id" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "denied" BOOLEAN NOT NULL DEFAULT false,
    "interval" INTEGER NOT NULL DEFAULT 5,
    "last_polled_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT,
    "session_id" TEXT,
    "type" TEXT NOT NULL,
    "client_id" TEXT,
    "ip_address" TEXT,
    "error" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_federations" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL DEFAULT 'ldap',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "connection_url" TEXT NOT NULL,
    "bind_dn" TEXT NOT NULL,
    "bind_credential" TEXT NOT NULL,
    "start_tls" BOOLEAN NOT NULL DEFAULT false,
    "connection_timeout" INTEGER NOT NULL DEFAULT 5000,
    "users_dn" TEXT NOT NULL,
    "user_object_class" TEXT NOT NULL DEFAULT 'inetOrgPerson',
    "username_ldap_attr" TEXT NOT NULL DEFAULT 'uid',
    "rdn_ldap_attr" TEXT NOT NULL DEFAULT 'uid',
    "uuid_ldap_attr" TEXT NOT NULL DEFAULT 'entryUUID',
    "search_filter" TEXT,
    "sync_mode" TEXT NOT NULL DEFAULT 'on_demand',
    "sync_period" INTEGER NOT NULL DEFAULT 3600,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "import_enabled" BOOLEAN NOT NULL DEFAULT true,
    "edit_mode" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_federations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_federation_mappers" (
    "id" TEXT NOT NULL,
    "federation_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapper_type" TEXT NOT NULL,
    "ldap_attribute" TEXT NOT NULL,
    "user_attribute" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_federation_mappers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_actions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "event_types" TEXT[],
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status_code" INTEGER,
    "response" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 4,
    "next_retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_events" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_path" TEXT NOT NULL,
    "representation" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_streams" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stream_type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "url" TEXT,
    "http_headers" JSONB,
    "syslog_host" TEXT,
    "syslog_port" INTEGER,
    "syslog_protocol" TEXT NOT NULL DEFAULT 'udp',
    "syslog_facility" INTEGER NOT NULL DEFAULT 16,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_log_streams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "effect" TEXT NOT NULL DEFAULT 'ALLOW',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "subject_conditions" JSONB,
    "resource_conditions" JSONB,
    "action_conditions" JSONB,
    "environment_conditions" JSONB,
    "logic" TEXT NOT NULL DEFAULT 'AND',
    "client_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_attributes" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "show_on_registration" BOOLEAN NOT NULL DEFAULT false,
    "show_on_profile" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB,
    "map_to_oidc_claim" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_attributes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "attribute_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authentication_flows" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "steps" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authentication_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installed_plugins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "file_hash" TEXT,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installed_plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_risk_assessments" (
    "id" TEXT NOT NULL,
    "login_event_id" TEXT,
    "user_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "risk_level" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "action" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "geo_location" TEXT,
    "device_fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_login_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "known_ips" JSONB NOT NULL DEFAULT '[]',
    "known_devices" JSONB NOT NULL DEFAULT '[]',
    "login_times" JSONB NOT NULL DEFAULT '[]',
    "last_locations" JSONB NOT NULL DEFAULT '[]',
    "avg_login_frequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_login_profiles_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "logo_url" TEXT,
    "primary_color" TEXT,
    "require_mfa" BOOLEAN NOT NULL DEFAULT false,
    "verified_domains" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_sso_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_sso_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revoked_tokens" (
    "jti" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revoked_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "admin_revoked_tokens" (
    "jti" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_revoked_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "service_accounts" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_accounts_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "service_account_id" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "name" TEXT,
    "scopes" TEXT[],
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),
    "rate_limit_per_minute" INTEGER,
    "max_requests_per_day" INTEGER,
    "max_requests_per_month" INTEGER,
    "require_ip_restriction" BOOLEAN NOT NULL DEFAULT false,
    "allowed_ip_ranges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
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
    "authme_attribute" TEXT NOT NULL,
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
CREATE TABLE "nhi_identities" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "identity_type" "NhiIdentityType" NOT NULL DEFAULT 'MACHINE_TO_MACHINE',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lifecycle_status" "NhiLifecycleStatus" NOT NULL DEFAULT 'PROVISIONING',
    "suspended_at" TIMESTAMP(3),
    "decommissioned_at" TIMESTAMP(3),
    "certificate_subject" TEXT,
    "certificate_fingerprint" TEXT,
    "certificate_not_before" TIMESTAMP(3),
    "certificate_not_after" TIMESTAMP(3),
    "agent_purpose" TEXT,
    "permission_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nhi_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nhi_credentials" (
    "id" TEXT NOT NULL,
    "nhi_identity_id" TEXT NOT NULL,
    "credential_type" "NhiCredentialType" NOT NULL DEFAULT 'API_KEY',
    "name" TEXT NOT NULL,
    "key_prefix" TEXT,
    "key_hash" TEXT,
    "certificate_pem" TEXT,
    "certificate_chain" TEXT,
    "private_key_pem" TEXT,
    "jwt_signing_algorithm" TEXT,
    "jwt_issuer" TEXT,
    "jwt_audience" TEXT,
    "expires_at" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "rotation_required" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "allowed_ip_ranges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nhi_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nhi_credential_policies" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "credential_type" "NhiCredentialType" NOT NULL DEFAULT 'API_KEY',
    "rotation_interval_days" INTEGER NOT NULL DEFAULT 90,
    "rotation_before_days" INTEGER NOT NULL DEFAULT 7,
    "auto_rotate" BOOLEAN NOT NULL DEFAULT false,
    "max_credential_age_days" INTEGER NOT NULL DEFAULT 365,
    "max_requests_per_day" INTEGER,
    "max_requests_per_month" INTEGER,
    "rate_limit_per_minute" INTEGER,
    "require_certificate" BOOLEAN NOT NULL DEFAULT false,
    "require_ip_restriction" BOOLEAN NOT NULL DEFAULT false,
    "require_audit_logging" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nhi_credential_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "nhi_usage_stats" (
    "id" TEXT NOT NULL,
    "nhi_identity_id" TEXT NOT NULL,
    "total_requests" INTEGER NOT NULL DEFAULT 0,
    "last_active_at" TIMESTAMP(3),
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "last_successful_at" TIMESTAMP(3),
    "last_failed_at" TIMESTAMP(3),
    "oldest_credential_age_days" INTEGER,
    "newest_credential_age_days" INTEGER,
    "credentials_expiring_soon" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nhi_usage_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_deletions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "grace_period_days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "export_status" TEXT,
    "export_requested_at" TIMESTAMP(3),
    "export_generated_at" TIMESTAMP(3),
    "export_url" TEXT,
    "ip_address" TEXT,

    CONSTRAINT "pending_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_categories" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "configurable_by_user" BOOLEAN NOT NULL DEFAULT true,
    "show_in_account_portal" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_policies" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consent_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_consent_history" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scopes" TEXT[],
    "policy_version" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consent_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "themes" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "description" TEXT,
    "theme_type" TEXT NOT NULL DEFAULT 'login',
    "version" INTEGER NOT NULL DEFAULT 1,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "styles" JSONB NOT NULL DEFAULT '{}',
    "components" JSONB NOT NULL DEFAULT '[]',
    "assets" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theme_versions" (
    "id" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changes" TEXT,
    "checksum" TEXT NOT NULL,
    "styles" JSONB NOT NULL DEFAULT '{}',
    "components" JSONB NOT NULL DEFAULT '[]',
    "assets" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "theme_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upgrade_audit_log" (
    "id" TEXT NOT NULL,
    "from_version" TEXT NOT NULL,
    "to_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "initiated_by" TEXT NOT NULL,
    "backup_id" TEXT,
    "backup_path" TEXT,
    "backup_size" TEXT,
    "ip_address" TEXT,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "rollback_triggered" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upgrade_audit_log_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "realms_name_key" ON "realms"("name");

-- CreateIndex
CREATE INDEX "users_realm_id_idx" ON "users"("realm_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_realm_id_username_key" ON "users"("realm_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "users_realm_id_email_key" ON "users"("realm_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "clients_realm_id_client_id_key" ON "clients"("realm_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_realm_id_client_id_name_key" ON "roles"("realm_id", "client_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE INDEX "sessions_realm_id_idx" ON "sessions"("realm_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "authorization_codes_code_key" ON "authorization_codes"("code");

-- CreateIndex
CREATE INDEX "authorization_codes_client_id_idx" ON "authorization_codes"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "realm_signing_keys_realm_id_kid_key" ON "realm_signing_keys"("realm_id", "kid");

-- CreateIndex
CREATE UNIQUE INDEX "login_sessions_token_hash_key" ON "login_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "step_up_records_session_id_idx" ON "step_up_records"("session_id");

-- CreateIndex
CREATE INDEX "step_up_records_expires_at_idx" ON "step_up_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_consents_user_id_client_id_key" ON "user_consents"("user_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "groups_realm_id_name_key" ON "groups"("realm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "user_groups_user_id_group_id_key" ON "user_groups"("user_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_roles_group_id_role_id_key" ON "group_roles"("group_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

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
CREATE INDEX "password_histories_user_id_idx" ON "password_histories"("user_id");

-- CreateIndex
CREATE INDEX "login_failures_realm_id_user_id_failed_at_idx" ON "login_failures"("realm_id", "user_id", "failed_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_user_id_type_key" ON "user_credentials"("user_id", "type");

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
CREATE INDEX "webauthn_credentials_user_id_idx" ON "webauthn_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_providers_realm_id_alias_key" ON "identity_providers"("realm_id", "alias");

-- CreateIndex
CREATE UNIQUE INDEX "federated_identities_identity_provider_id_external_user_id_key" ON "federated_identities"("identity_provider_id", "external_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "federated_identities_user_id_identity_provider_id_key" ON "federated_identities"("user_id", "identity_provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "saml_service_providers_realm_id_entity_id_key" ON "saml_service_providers"("realm_id", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_scopes_realm_id_name_key" ON "client_scopes"("realm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_mappers_client_scope_id_name_key" ON "protocol_mappers"("client_scope_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "client_default_scopes_client_id_client_scope_id_key" ON "client_default_scopes"("client_id", "client_scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_optional_scopes_client_id_client_scope_id_key" ON "client_optional_scopes"("client_id", "client_scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_codes_device_code_key" ON "device_codes"("device_code");

-- CreateIndex
CREATE UNIQUE INDEX "device_codes_user_code_key" ON "device_codes"("user_code");

-- CreateIndex
CREATE INDEX "login_events_realm_id_created_at_idx" ON "login_events"("realm_id", "created_at");

-- CreateIndex
CREATE INDEX "login_events_realm_id_type_idx" ON "login_events"("realm_id", "type");

-- CreateIndex
CREATE INDEX "login_events_realm_id_user_id_idx" ON "login_events"("realm_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_federations_realm_id_name_key" ON "user_federations"("realm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "user_federation_mappers_federation_id_name_key" ON "user_federation_mappers"("federation_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pending_actions_token_hash_key" ON "pending_actions"("token_hash");

-- CreateIndex
CREATE INDEX "pending_actions_expires_at_idx" ON "pending_actions"("expires_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries"("webhook_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_events_status_next_retry_at_idx" ON "webhook_events"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "webhook_events_realm_id_created_at_idx" ON "webhook_events"("realm_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_events_realm_id_created_at_idx" ON "admin_events"("realm_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_events_realm_id_resource_type_idx" ON "admin_events"("realm_id", "resource_type");

-- CreateIndex
CREATE INDEX "impersonation_sessions_realm_id_admin_user_id_idx" ON "impersonation_sessions"("realm_id", "admin_user_id");

-- CreateIndex
CREATE INDEX "impersonation_sessions_realm_id_target_user_id_idx" ON "impersonation_sessions"("realm_id", "target_user_id");

-- CreateIndex
CREATE INDEX "impersonation_sessions_session_id_idx" ON "impersonation_sessions"("session_id");

-- CreateIndex
CREATE INDEX "policies_realm_id_idx" ON "policies"("realm_id");

-- CreateIndex
CREATE INDEX "policies_realm_id_client_id_idx" ON "policies"("realm_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_attributes_realm_id_name_key" ON "custom_attributes"("realm_id", "name");

-- CreateIndex
CREATE INDEX "user_attributes_user_id_idx" ON "user_attributes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_attributes_user_id_attribute_id_key" ON "user_attributes"("user_id", "attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "authentication_flows_realm_id_name_key" ON "authentication_flows"("realm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "installed_plugins_name_key" ON "installed_plugins"("name");

-- CreateIndex
CREATE INDEX "login_risk_assessments_user_id_created_at_idx" ON "login_risk_assessments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "login_risk_assessments_realm_id_created_at_idx" ON "login_risk_assessments"("realm_id", "created_at");

-- CreateIndex
CREATE INDEX "login_risk_assessments_risk_level_idx" ON "login_risk_assessments"("risk_level");

-- CreateIndex
CREATE UNIQUE INDEX "user_login_profiles_user_id_key" ON "user_login_profiles"("user_id");

-- CreateIndex
CREATE INDEX "user_login_profiles_realm_id_idx" ON "user_login_profiles"("realm_id");

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
CREATE UNIQUE INDEX "organizations_realm_id_slug_key" ON "organizations"("realm_id", "slug");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_token_key" ON "organization_invitations"("token");

-- CreateIndex
CREATE INDEX "revoked_tokens_expires_at_idx" ON "revoked_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "admin_revoked_tokens_expires_at_idx" ON "admin_revoked_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "service_accounts_realm_id_idx" ON "service_accounts"("realm_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_accounts_realm_id_name_key" ON "service_accounts"("realm_id", "name");

-- CreateIndex
CREATE INDEX "sms_delivery_logs_realm_id_user_id_created_at_idx" ON "sms_delivery_logs"("realm_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "sms_delivery_logs_realm_id_created_at_idx" ON "sms_delivery_logs"("realm_id", "created_at");

-- CreateIndex
CREATE INDEX "otp_attempts_realm_id_user_id_expires_at_idx" ON "otp_attempts"("realm_id", "user_id", "expires_at");

-- CreateIndex
CREATE INDEX "otp_attempts_realm_id_phone_hash_expires_at_idx" ON "otp_attempts"("realm_id", "phone_hash", "expires_at");

-- CreateIndex
CREATE INDEX "api_keys_service_account_id_idx" ON "api_keys"("service_account_id");

-- CreateIndex
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys"("key_prefix");

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
CREATE INDEX "nhi_identities_realm_id_idx" ON "nhi_identities"("realm_id");

-- CreateIndex
CREATE INDEX "nhi_identities_lifecycle_status_idx" ON "nhi_identities"("lifecycle_status");

-- CreateIndex
CREATE UNIQUE INDEX "nhi_identities_realm_id_name_key" ON "nhi_identities"("realm_id", "name");

-- CreateIndex
CREATE INDEX "nhi_credentials_nhi_identity_id_idx" ON "nhi_credentials"("nhi_identity_id");

-- CreateIndex
CREATE INDEX "nhi_credentials_key_prefix_idx" ON "nhi_credentials"("key_prefix");

-- CreateIndex
CREATE INDEX "nhi_credentials_expires_at_idx" ON "nhi_credentials"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "nhi_credentials_nhi_identity_id_name_key" ON "nhi_credentials"("nhi_identity_id", "name");

-- CreateIndex
CREATE INDEX "nhi_credential_policies_realm_id_idx" ON "nhi_credential_policies"("realm_id");

-- CreateIndex
CREATE INDEX "nhi_credential_policies_realm_id_priority_idx" ON "nhi_credential_policies"("realm_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "nhi_credential_policies_realm_id_name_key" ON "nhi_credential_policies"("realm_id", "name");

-- CreateIndex
CREATE INDEX "nhi_audit_logs_realm_id_idx" ON "nhi_audit_logs"("realm_id");

-- CreateIndex
CREATE INDEX "nhi_audit_logs_nhi_identity_id_idx" ON "nhi_audit_logs"("nhi_identity_id");

-- CreateIndex
CREATE INDEX "nhi_audit_logs_action_idx" ON "nhi_audit_logs"("action");

-- CreateIndex
CREATE INDEX "nhi_audit_logs_created_at_idx" ON "nhi_audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "nhi_usage_stats_nhi_identity_id_key" ON "nhi_usage_stats"("nhi_identity_id");

-- CreateIndex
CREATE UNIQUE INDEX "pending_deletions_user_id_key" ON "pending_deletions"("user_id");

-- CreateIndex
CREATE INDEX "pending_deletions_status_idx" ON "pending_deletions"("status");

-- CreateIndex
CREATE INDEX "pending_deletions_scheduled_at_idx" ON "pending_deletions"("scheduled_at");

-- CreateIndex
CREATE INDEX "consent_categories_realm_id_idx" ON "consent_categories"("realm_id");

-- CreateIndex
CREATE UNIQUE INDEX "consent_categories_realm_id_key_key" ON "consent_categories"("realm_id", "key");

-- CreateIndex
CREATE INDEX "consent_policies_category_id_idx" ON "consent_policies"("category_id");

-- CreateIndex
CREATE INDEX "consent_policies_category_id_is_active_idx" ON "consent_policies"("category_id", "is_active");

-- CreateIndex
CREATE INDEX "user_consent_history_user_id_idx" ON "user_consent_history"("user_id");

-- CreateIndex
CREATE INDEX "user_consent_history_client_id_idx" ON "user_consent_history"("client_id");

-- CreateIndex
CREATE INDEX "user_consent_history_created_at_idx" ON "user_consent_history"("created_at");

-- CreateIndex
CREATE INDEX "themes_realm_id_idx" ON "themes"("realm_id");

-- CreateIndex
CREATE UNIQUE INDEX "themes_realm_id_name_key" ON "themes"("realm_id", "name");

-- CreateIndex
CREATE INDEX "theme_versions_theme_id_idx" ON "theme_versions"("theme_id");

-- CreateIndex
CREATE UNIQUE INDEX "theme_versions_theme_id_version_key" ON "theme_versions"("theme_id", "version");

-- CreateIndex
CREATE INDEX "upgrade_audit_log_status_idx" ON "upgrade_audit_log"("status");

-- CreateIndex
CREATE INDEX "upgrade_audit_log_started_at_idx" ON "upgrade_audit_log"("started_at");

-- CreateIndex
CREATE INDEX "upgrade_audit_log_from_version_to_version_idx" ON "upgrade_audit_log"("from_version", "to_version");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_entries_key_key" ON "rate_limit_entries"("key");

-- CreateIndex
CREATE INDEX "rate_limit_entries_key_idx" ON "rate_limit_entries"("key");

-- CreateIndex
CREATE INDEX "rate_limit_entries_minute_window_start_idx" ON "rate_limit_entries"("minute_window_start");

-- CreateIndex
CREATE INDEX "rate_limit_entries_hour_window_start_idx" ON "rate_limit_entries"("hour_window_start");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_auth_flow_id_fkey" FOREIGN KEY ("auth_flow_id") REFERENCES "authentication_flows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realm_signing_keys" ADD CONSTRAINT "realm_signing_keys_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_link_requests" ADD CONSTRAINT "magic_link_requests_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_link_requests" ADD CONSTRAINT "magic_link_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_histories" ADD CONSTRAINT "password_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_histories" ADD CONSTRAINT "password_histories_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_failures" ADD CONSTRAINT "login_failures_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_failures" ADD CONSTRAINT "login_failures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "used_totp_codes" ADD CONSTRAINT "used_totp_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_failure_tracking" ADD CONSTRAINT "totp_failure_tracking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_failure_tracking" ADD CONSTRAINT "webauthn_failure_tracking_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_failure_tracking" ADD CONSTRAINT "webauthn_failure_tracking_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_providers" ADD CONSTRAINT "identity_providers_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "federated_identities" ADD CONSTRAINT "federated_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "federated_identities" ADD CONSTRAINT "federated_identities_identity_provider_id_fkey" FOREIGN KEY ("identity_provider_id") REFERENCES "identity_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saml_service_providers" ADD CONSTRAINT "saml_service_providers_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_scopes" ADD CONSTRAINT "client_scopes_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_mappers" ADD CONSTRAINT "protocol_mappers_client_scope_id_fkey" FOREIGN KEY ("client_scope_id") REFERENCES "client_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_default_scopes" ADD CONSTRAINT "client_default_scopes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_default_scopes" ADD CONSTRAINT "client_default_scopes_client_scope_id_fkey" FOREIGN KEY ("client_scope_id") REFERENCES "client_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_optional_scopes" ADD CONSTRAINT "client_optional_scopes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_optional_scopes" ADD CONSTRAINT "client_optional_scopes_client_scope_id_fkey" FOREIGN KEY ("client_scope_id") REFERENCES "client_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_federations" ADD CONSTRAINT "user_federations_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_federation_mappers" ADD CONSTRAINT "user_federation_mappers_federation_id_fkey" FOREIGN KEY ("federation_id") REFERENCES "user_federations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_events" ADD CONSTRAINT "admin_events_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log_streams" ADD CONSTRAINT "audit_log_streams_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_attributes" ADD CONSTRAINT "custom_attributes_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_attributes" ADD CONSTRAINT "user_attributes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_attributes" ADD CONSTRAINT "user_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "custom_attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authentication_flows" ADD CONSTRAINT "authentication_flows_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_risk_assessments" ADD CONSTRAINT "login_risk_assessments_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_risk_assessments" ADD CONSTRAINT "login_risk_assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_login_profiles" ADD CONSTRAINT "user_login_profiles_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_sso_connections" ADD CONSTRAINT "organization_sso_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_delivery_logs" ADD CONSTRAINT "sms_delivery_logs_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_attempts" ADD CONSTRAINT "otp_attempts_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_service_account_id_fkey" FOREIGN KEY ("service_account_id") REFERENCES "service_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_provisioning_tokens" ADD CONSTRAINT "scim_provisioning_tokens_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scim_attribute_mappings" ADD CONSTRAINT "scim_attribute_mappings_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_fields" ADD CONSTRAINT "registration_fields_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nhi_identities" ADD CONSTRAINT "nhi_identities_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nhi_credentials" ADD CONSTRAINT "nhi_credentials_nhi_identity_id_fkey" FOREIGN KEY ("nhi_identity_id") REFERENCES "nhi_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nhi_credential_policies" ADD CONSTRAINT "nhi_credential_policies_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nhi_audit_logs" ADD CONSTRAINT "nhi_audit_logs_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nhi_usage_stats" ADD CONSTRAINT "nhi_usage_stats_nhi_identity_id_fkey" FOREIGN KEY ("nhi_identity_id") REFERENCES "nhi_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_deletions" ADD CONSTRAINT "pending_deletions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_categories" ADD CONSTRAINT "consent_categories_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_policies" ADD CONSTRAINT "consent_policies_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "consent_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consent_history" ADD CONSTRAINT "user_consent_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consent_history" ADD CONSTRAINT "user_consent_history_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "themes" ADD CONSTRAINT "themes_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theme_versions" ADD CONSTRAINT "theme_versions_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
