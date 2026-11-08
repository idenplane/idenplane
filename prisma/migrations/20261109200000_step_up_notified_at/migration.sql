-- When a session's current step-up requirement was announced (risk event and
-- WebSocket push), so the scheduler announces each risk episode once rather
-- than every minute until it expires. Cleared when the episode ends.
ALTER TABLE "session_risk_profiles" ADD COLUMN "step_up_notified_at" TIMESTAMP(3);
