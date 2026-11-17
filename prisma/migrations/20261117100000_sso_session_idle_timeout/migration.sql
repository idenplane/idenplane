-- SSO session idle timeout (0.12.0).
--
-- A realm setting, off (0) for every realm, new and upgraded: with it off a
-- session ends only at its maximum lifetime, as before. Turning it on ends a
-- browser SSO session that has not been used for that many seconds, and
-- caps every normal (not offline) refresh token at that long from its issue.
--
-- login_sessions.last_activity_at records when a session was last used.
-- Existing sessions start their idle window at the upgrade, not at their
-- creation: turning the timeout on later must not end, all at once, every
-- session that was in use but never had its activity recorded.

-- AlterTable
ALTER TABLE "realms" ADD COLUMN "sso_session_idle_timeout" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "login_sessions" ADD COLUMN "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
