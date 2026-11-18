-- SAML identity-provider broker (0.13.0): Idenplane as a SAML service provider.
--
-- identity_providers.saml_config (already present, unused until now) holds a
-- `saml` provider's settings. Two new tables:
--
-- saml_broker_requests: one row per SAML sign-in, from the redirect to the
-- provider until the browser that started it finishes it. It holds the
-- AuthnRequest ID (the only InResponseTo the ACS accepts), the short random
-- RelayState, a hash of the browser-binding cookie and the broker state. Each
-- step claims the row with a conditional update, so a step runs once.
--
-- saml_broker_assertion_ids: the replay check. The unique (provider,
-- assertion ID) index makes the insert the claim, across every replica and
-- worker. Expired rows of both tables are deleted by a scheduled job.
-- CreateTable
CREATE TABLE "saml_broker_requests" (
    "id" TEXT NOT NULL,
    "identity_provider_id" TEXT NOT NULL,
    "start_handle" TEXT NOT NULL,
    "request_id" TEXT,
    "relay_state" TEXT,
    "binding_hash" TEXT,
    "state" JSONB NOT NULL,
    "result" JSONB,
    "started_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saml_broker_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saml_broker_assertion_ids" (
    "id" TEXT NOT NULL,
    "identity_provider_id" TEXT NOT NULL,
    "assertion_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saml_broker_assertion_ids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saml_broker_requests_start_handle_key" ON "saml_broker_requests"("start_handle");

-- CreateIndex
CREATE UNIQUE INDEX "saml_broker_requests_request_id_key" ON "saml_broker_requests"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "saml_broker_requests_relay_state_key" ON "saml_broker_requests"("relay_state");

-- CreateIndex
CREATE INDEX "saml_broker_requests_expires_at_idx" ON "saml_broker_requests"("expires_at");

-- CreateIndex
CREATE INDEX "saml_broker_requests_identity_provider_id_idx" ON "saml_broker_requests"("identity_provider_id");

-- CreateIndex
CREATE INDEX "saml_broker_assertion_ids_expires_at_idx" ON "saml_broker_assertion_ids"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "saml_broker_assertion_ids_identity_provider_id_assertion_id_key" ON "saml_broker_assertion_ids"("identity_provider_id", "assertion_id");

-- AddForeignKey
ALTER TABLE "saml_broker_requests" ADD CONSTRAINT "saml_broker_requests_identity_provider_id_fkey" FOREIGN KEY ("identity_provider_id") REFERENCES "identity_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saml_broker_assertion_ids" ADD CONSTRAINT "saml_broker_assertion_ids_identity_provider_id_fkey" FOREIGN KEY ("identity_provider_id") REFERENCES "identity_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A `saml` row stored before 0.12.0 in another case ('SAML') gets the
-- canonical type, so the console shows its SAML settings to complete. Its
-- saml_config is left as it is: until it holds a valid configuration the
-- broker refuses the sign-in, and GET /admin/upgrade/health
-- (identity_provider_types) lists the row for review.
UPDATE "identity_providers"
   SET "provider_type" = 'saml'
 WHERE lower(btrim("provider_type")) = 'saml'
   AND "provider_type" <> 'saml';
