-- Cache invalidation for what goes into a token about its user: the user's
-- profile, roles (direct and through groups), custom-attribute claims and
-- the realm's scope mappers, plus the list of revoked token ids. Same
-- mechanism as the cache_invalidation_triggers migration: the database
-- announces every change itself, on commit, to every process.
--
-- Payloads (channel idenplane_cache):
--   {"t":"users","ids":[...]}   these users' profile and grants changed
--   {"t":"grants"}              roles, groups or attribute definitions
--                               changed: every user's grants may have
--   {"t":"scopes"}              client scopes or their mappers changed
--   {"t":"revoked","jti":..,"exp":..}  a token id was revoked
--
-- Statement-level triggers with transition tables send one notification per
-- statement, not per row, so an import or a bulk delete does not flood the
-- channel. A statement touching more users than fit in one payload sends
-- "grants" instead, which drops every user's cached grants.

CREATE OR REPLACE FUNCTION idenplane_claims_notify_users() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ids text[];
BEGIN
  -- Each branch reads only the transition tables its event has.
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT user_id) INTO ids FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT user_id) INTO ids FROM old_rows;
  ELSE
    SELECT array_agg(DISTINCT user_id) INTO ids
      FROM (SELECT user_id FROM new_rows UNION SELECT user_id FROM old_rows) changed;
  END IF;
  IF ids IS NULL THEN
    RETURN NULL;
  END IF;
  IF array_length(ids, 1) > 100 THEN
    PERFORM pg_notify('idenplane_cache', '{"t":"grants"}');
  ELSE
    PERFORM pg_notify('idenplane_cache',
      jsonb_build_object('t', 'users', 'ids', to_jsonb(ids))::text);
  END IF;
  RETURN NULL;
END;
$$;

-- user_roles, user_groups and user_attributes all name their user user_id.
CREATE TRIGGER user_roles_claims_notify_ins AFTER INSERT ON "user_roles"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_users();
CREATE TRIGGER user_roles_claims_notify_upd AFTER UPDATE ON "user_roles"
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_users();
CREATE TRIGGER user_roles_claims_notify_del AFTER DELETE ON "user_roles"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_users();

CREATE TRIGGER user_groups_claims_notify_ins AFTER INSERT ON "user_groups"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_users();
CREATE TRIGGER user_groups_claims_notify_upd AFTER UPDATE ON "user_groups"
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_users();
CREATE TRIGGER user_groups_claims_notify_del AFTER DELETE ON "user_groups"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_users();

CREATE TRIGGER user_attributes_claims_notify_ins AFTER INSERT ON "user_attributes"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_users();
CREATE TRIGGER user_attributes_claims_notify_upd AFTER UPDATE ON "user_attributes"
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_users();
CREATE TRIGGER user_attributes_claims_notify_del AFTER DELETE ON "user_attributes"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_users();

-- The users table itself. Sign-ins write it constantly (lockout state,
-- updated_at, a password rehash), and none of that is in a token, so an
-- update is announced only when a column the cache holds actually changed.
-- That test runs in the trigger's WHEN clause, before any function call.
CREATE OR REPLACE FUNCTION idenplane_claims_notify_user_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('idenplane_cache',
    jsonb_build_object('t', 'users', 'ids', jsonb_build_array(OLD.id))::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER users_claims_notify_upd
  AFTER UPDATE OF id, realm_id, username, email, email_verified, first_name,
                  last_name, enabled, federation_link, created_at
  ON "users"
  FOR EACH ROW
  WHEN (
    (OLD.id, OLD.realm_id, OLD.username, OLD.email, OLD.email_verified,
     OLD.first_name, OLD.last_name, OLD.enabled, OLD.federation_link,
     OLD.created_at)
    IS DISTINCT FROM
    (NEW.id, NEW.realm_id, NEW.username, NEW.email, NEW.email_verified,
     NEW.first_name, NEW.last_name, NEW.enabled, NEW.federation_link,
     NEW.created_at)
  )
  EXECUTE FUNCTION idenplane_claims_notify_user_row();

CREATE OR REPLACE FUNCTION idenplane_claims_notify_users_deleted() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ids text[];
BEGIN
  SELECT array_agg(id) INTO ids FROM old_rows;
  IF ids IS NULL THEN
    RETURN NULL;
  END IF;
  IF array_length(ids, 1) > 100 THEN
    PERFORM pg_notify('idenplane_cache', '{"t":"grants"}');
  ELSE
    PERFORM pg_notify('idenplane_cache',
      jsonb_build_object('t', 'users', 'ids', to_jsonb(ids))::text);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER users_claims_notify_del AFTER DELETE ON "users"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_users_deleted();

-- Realm-wide definitions: an administrator's changes, rare and possibly
-- affecting any number of users through the group tree. One announcement
-- per statement drops every user's grants.
CREATE OR REPLACE FUNCTION idenplane_claims_notify_all() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('idenplane_cache', jsonb_build_object('t', TG_ARGV[0])::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER roles_claims_notify
  AFTER INSERT OR UPDATE OR DELETE ON "roles"
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_all('grants');
CREATE TRIGGER groups_claims_notify
  AFTER INSERT OR UPDATE OR DELETE ON "groups"
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_all('grants');
CREATE TRIGGER group_roles_claims_notify
  AFTER INSERT OR UPDATE OR DELETE ON "group_roles"
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_all('grants');
CREATE TRIGGER custom_attributes_claims_notify
  AFTER INSERT OR UPDATE OR DELETE ON "custom_attributes"
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_all('grants');

CREATE TRIGGER client_scopes_claims_notify
  AFTER INSERT OR UPDATE OR DELETE ON "client_scopes"
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_all('scopes');
CREATE TRIGGER protocol_mappers_claims_notify
  AFTER INSERT OR UPDATE OR DELETE ON "protocol_mappers"
  FOR EACH STATEMENT EXECUTE FUNCTION idenplane_claims_notify_all('scopes');

-- Revoked token ids. Only additions are announced: expired ids are pruned
-- by each process on its own, and an id deleted by the periodic cleanup has
-- expired already.
CREATE OR REPLACE FUNCTION idenplane_claims_notify_revoked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('idenplane_cache', jsonb_build_object(
    't', 'revoked', 'jti', NEW.jti,
    'exp', floor(extract(epoch FROM NEW.expires_at)))::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER revoked_tokens_claims_notify AFTER INSERT ON "revoked_tokens"
  FOR EACH ROW EXECUTE FUNCTION idenplane_claims_notify_revoked();
