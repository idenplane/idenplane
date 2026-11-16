-- Offline sessions get the offline lifespan (0.11.0).
--
-- Before 0.11.0 a session created with offline_access got the normal session
-- expiry (refresh_token_lifespan), so the hourly clean-up deleted it, and its
-- offline tokens with it, after 30-90 minutes. From 0.11.0 such a session
-- expires at created_at + offline_token_lifespan.
--
-- This extends the offline sessions still alive at upgrade time to the
-- lifetime they were issued for: the user consented to offline access, the
-- client holds an offline token whose own expires_at already says
-- offline_token_lifespan, and only the bug was going to end it. Only
-- sessions that have an offline refresh token that is not revoked and not
-- expired are touched. Revoked, expired and already deleted sessions stay
-- ended: nothing is brought back. GREATEST never shortens a session (a realm
-- whose offline lifespan is shorter than its normal one).
UPDATE "sessions" AS s
   SET "expires_at" = GREATEST(
         s."expires_at",
         s."created_at" + make_interval(secs => r."offline_token_lifespan")
       )
  FROM "users" AS u
  JOIN "realms" AS r ON r."id" = u."realm_id"
 WHERE u."id" = s."user_id"
   AND s."expires_at" > now()
   AND EXISTS (
         SELECT 1
           FROM "refresh_tokens" AS rt
          WHERE rt."session_id" = s."id"
            AND rt."is_offline"
            AND NOT rt."revoked"
            AND rt."expires_at" > now()
       );
