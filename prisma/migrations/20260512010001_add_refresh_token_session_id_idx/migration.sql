-- AddIndexToRefreshTokensSessionId
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");