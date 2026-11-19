-- Instance usage: monthly active users (GET /admin/system/usage).
--
-- user_monthly_activity: one row per user who authenticated in a calendar
-- month (UTC), written once per user and month. The primary key is the
-- idempotency check of the insert and the index the per-realm count of a
-- month reads. No foreign keys on purpose: deleting a user or a realm does
-- not erase activity that already happened, and the login event retention
-- (30 days by default) does not apply.
--
-- usage_tracking: one row, the time this instance started recording. Months
-- that start before it are reported as incomplete.

-- CreateTable
CREATE TABLE "user_monthly_activity" (
    "month" DATE NOT NULL,
    "realm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_monthly_activity_pkey" PRIMARY KEY ("month","realm_id","user_id")
);

-- CreateTable
CREATE TABLE "usage_tracking" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "tracking_since" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_tracking_pkey" PRIMARY KEY ("id")
);

-- Best-effort backfill from the login events still retained: the successful
-- user authentications that the recorder counts from now on (a sign-in, a
-- code or device-code exchange, a refresh, the mfa_otp grant). Realms with
-- events turned off, and events already pruned, are not recoverable; the
-- months this covers are reported as incomplete.
INSERT INTO "user_monthly_activity" ("month", "realm_id", "user_id", "first_seen_at")
SELECT date_trunc('month', "created_at")::date, "realm_id", "user_id", min("created_at")
FROM "login_events"
WHERE "user_id" IS NOT NULL
  AND (
    "type" IN ('LOGIN', 'CODE_TO_TOKEN', 'DEVICE_CODE_TO_TOKEN', 'TOKEN_REFRESH', 'FEDERATED_LOGIN')
    -- The mfa_otp grant; an admin console MFA check has no client.
    OR ("type" = 'MFA_VERIFY' AND "client_id" IS NOT NULL)
  )
GROUP BY 1, 2, 3
ON CONFLICT DO NOTHING;

-- Recording starts now. A new install (no users yet) has no activity before
-- this, so its first month is complete from the start of the month.
INSERT INTO "usage_tracking" ("id", "tracking_since")
SELECT 1,
       CASE WHEN EXISTS (SELECT 1 FROM "users")
            THEN (now() AT TIME ZONE 'UTC')
            ELSE date_trunc('month', now() AT TIME ZONE 'UTC')
       END;
