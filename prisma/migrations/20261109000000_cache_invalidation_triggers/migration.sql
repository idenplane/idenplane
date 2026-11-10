-- Cache invalidation from the database itself.
--
-- Every server process keeps realms, clients and the JWKS in memory and drops
-- an entry when the row behind it changes. The change is announced here, by
-- the database, rather than by the code that made it: that covers every
-- writer, including importers, nested writes, updateMany and SQL run by
-- hand, and it reaches every process and every replica.
--
-- NOTIFY is transactional: listeners hear it only when the transaction
-- commits, and identical payloads within one transaction are sent once.
-- A cascade (deleting a realm deletes its clients and keys) fires the
-- triggers on the child rows too.
--
-- Payloads name the cache keys of both the old and the new row, so a rename
-- (realm name, client_id) evicts the entry under the old name as well.

CREATE OR REPLACE FUNCTION idenplane_cache_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  payload jsonb;
BEGIN
  IF TG_TABLE_NAME = 'realms' THEN
    IF TG_OP = 'INSERT' THEN
      payload := jsonb_build_object('t', 'realm', 'id', NEW.id, 'names', jsonb_build_array(NEW.name));
    ELSIF TG_OP = 'UPDATE' THEN
      payload := jsonb_build_object('t', 'realm', 'id', NEW.id, 'names', jsonb_build_array(OLD.name, NEW.name));
    ELSE
      payload := jsonb_build_object('t', 'realm', 'id', OLD.id, 'names', jsonb_build_array(OLD.name));
    END IF;
  ELSIF TG_TABLE_NAME = 'clients' THEN
    IF TG_OP = 'INSERT' THEN
      payload := jsonb_build_object('t', 'client', 'realmId', NEW.realm_id, 'id', NEW.id, 'clientIds', jsonb_build_array(NEW.client_id));
    ELSIF TG_OP = 'UPDATE' THEN
      payload := jsonb_build_object('t', 'client', 'realmId', NEW.realm_id, 'id', NEW.id, 'clientIds', jsonb_build_array(OLD.client_id, NEW.client_id));
    ELSE
      payload := jsonb_build_object('t', 'client', 'realmId', OLD.realm_id, 'id', OLD.id, 'clientIds', jsonb_build_array(OLD.client_id));
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    payload := jsonb_build_object('t', 'keys', 'realmId', OLD.realm_id);
  ELSE
    payload := jsonb_build_object('t', 'keys', 'realmId', NEW.realm_id);
  END IF;
  PERFORM pg_notify('idenplane_cache', payload::text);
  RETURN NULL;
END;
$$;

CREATE TRIGGER realms_cache_notify
  AFTER INSERT OR UPDATE OR DELETE ON "realms"
  FOR EACH ROW EXECUTE FUNCTION idenplane_cache_notify();

CREATE TRIGGER clients_cache_notify
  AFTER INSERT OR UPDATE OR DELETE ON "clients"
  FOR EACH ROW EXECUTE FUNCTION idenplane_cache_notify();

CREATE TRIGGER realm_signing_keys_cache_notify
  AFTER INSERT OR UPDATE OR DELETE ON "realm_signing_keys"
  FOR EACH ROW EXECUTE FUNCTION idenplane_cache_notify();
