-- Auth-flow binding model (inert at login until the runtime ships).
-- * realms.browser_flow_id / auth_flows_enabled: explicit realm binding and opt-in switch.
-- * authentication_flows.version: incremented on every update.
-- * clients.auth_flow_id: ON DELETE SET NULL -> NO ACTION, so deleting a bound flow can
--   never silently unbind (downgrade) a client. NO ACTION rather than RESTRICT so a realm
--   delete can still cascade clients, flows and the realm in one statement.
-- Same-realm membership of both references is enforced in AuthFlowService.

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_auth_flow_id_fkey";

-- AlterTable
ALTER TABLE "authentication_flows" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "realms" ADD COLUMN     "auth_flows_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "browser_flow_id" TEXT;

-- CreateIndex
CREATE INDEX "clients_auth_flow_id_idx" ON "clients"("auth_flow_id");

-- AddForeignKey
ALTER TABLE "realms" ADD CONSTRAINT "realms_browser_flow_id_fkey" FOREIGN KEY ("browser_flow_id") REFERENCES "authentication_flows"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_auth_flow_id_fkey" FOREIGN KEY ("auth_flow_id") REFERENCES "authentication_flows"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
