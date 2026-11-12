-- OIDC auth_time: when the end user authenticated, not when the code was exchanged.
ALTER TABLE "authorization_codes" ADD COLUMN "auth_time" TIMESTAMP(3);

-- The session created by the exchange, ended if the code is replayed.
ALTER TABLE "authorization_codes" ADD COLUMN "session_id" TEXT;
