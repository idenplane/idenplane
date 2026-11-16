-- Secure defaults for NEW realms (0.10.0).
--
-- Only the column defaults change. No existing row is updated: a realm that
-- had brute-force protection or event recording off keeps it off until an
-- administrator turns it on (see CHANGELOG "Before you upgrade").
ALTER TABLE "realms" ALTER COLUMN "brute_force_enabled" SET DEFAULT true;
ALTER TABLE "realms" ALTER COLUMN "max_login_failures" SET DEFAULT 10;
ALTER TABLE "realms" ALTER COLUMN "lockout_duration" SET DEFAULT 300;
ALTER TABLE "realms" ALTER COLUMN "failure_reset_time" SET DEFAULT 900;
ALTER TABLE "realms" ALTER COLUMN "events_enabled" SET DEFAULT true;
ALTER TABLE "realms" ALTER COLUMN "admin_events_enabled" SET DEFAULT true;
