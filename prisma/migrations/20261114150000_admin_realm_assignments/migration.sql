-- Admin RBAC: the realms a `realm-admin` may manage.
--
-- A realm-admin is a user of the master realm with the `realm-admin` role.
-- Each row lets that admin manage one realm. A realm-admin with no row
-- manages no realm (fail closed). Rows go when the user or the realm goes.

-- CreateTable
CREATE TABLE "admin_realm_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_realm_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_realm_assignments_realm_id_idx" ON "admin_realm_assignments"("realm_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_realm_assignments_user_id_realm_id_key" ON "admin_realm_assignments"("user_id", "realm_id");

-- AddForeignKey
ALTER TABLE "admin_realm_assignments" ADD CONSTRAINT "admin_realm_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_realm_assignments" ADD CONSTRAINT "admin_realm_assignments_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The admin must be a user of the master realm, and the realm must not be
-- the master realm: a realm-admin of master could grant itself super-admin
-- through the master realm's role mappings. The API refuses both too; this
-- keeps a direct write from getting round it.
CREATE OR REPLACE FUNCTION idenplane_admin_realm_assignment_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  user_realm text;
  target_realm text;
BEGIN
  SELECT r."name" INTO user_realm
    FROM "users" u JOIN "realms" r ON r."id" = u."realm_id"
   WHERE u."id" = NEW."user_id";
  IF user_realm IS DISTINCT FROM 'master' THEN
    RAISE EXCEPTION 'admin realm assignment %: user % is not a master realm user',
      NEW."id", NEW."user_id"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT "name" INTO target_realm FROM "realms" WHERE "id" = NEW."realm_id";
  IF target_realm = 'master' THEN
    RAISE EXCEPTION 'admin realm assignment %: the master realm cannot be assigned',
      NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_realm_assignments_check
  BEFORE INSERT OR UPDATE OF "user_id", "realm_id" ON "admin_realm_assignments"
  FOR EACH ROW EXECUTE FUNCTION idenplane_admin_realm_assignment_check();
