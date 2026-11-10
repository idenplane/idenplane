-- Cache invalidation for "does this session still exist?", which every
-- introspection and userinfo call of a user's token asks. Only an ended
-- session changes the answer (sessions are never moved to another id), so
-- only deletions are announced, once per statement:
--
--   {"t":"sessions","ids":[...]}   these sessions ended
--   {"t":"sessions-all"}           too many to list: forget every session
--
-- A deleted user, client or realm takes its sessions with it through the
-- cascade, which fires this trigger too.

CREATE OR REPLACE FUNCTION idenplane_sessions_notify_deleted() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ids text[];
BEGIN
  SELECT array_agg(id) INTO ids FROM old_rows;
  IF ids IS NULL THEN
    RETURN NULL;
  END IF;
  IF array_length(ids, 1) > 100 THEN
    PERFORM pg_notify('idenplane_cache', '{"t":"sessions-all"}');
  ELSE
    PERFORM pg_notify('idenplane_cache',
      jsonb_build_object('t', 'sessions', 'ids', to_jsonb(ids))::text);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER sessions_cache_notify_del AFTER DELETE ON "sessions"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_sessions_notify_deleted();
