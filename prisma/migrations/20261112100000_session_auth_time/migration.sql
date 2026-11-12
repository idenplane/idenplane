-- OIDC auth_time of a token session, kept across refreshes (OIDC Core §12.2).
ALTER TABLE "sessions" ADD COLUMN "auth_time" TIMESTAMP(3);
