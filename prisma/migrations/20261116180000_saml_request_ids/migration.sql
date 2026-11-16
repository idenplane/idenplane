-- Replay protection for SAML AuthnRequests (0.11.0).
--
-- One row per AuthnRequest ID a service provider sent and the IdP accepted,
-- kept until the request is too old to pass the IssueInstant check. The
-- unique (sp_id, request_id) index makes the insert the replay check, across
-- every replica and worker. Expired rows are deleted by a scheduled job.
-- CreateTable
CREATE TABLE "saml_request_ids" (
    "id" TEXT NOT NULL,
    "sp_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saml_request_ids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saml_request_ids_expires_at_idx" ON "saml_request_ids"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "saml_request_ids_sp_id_request_id_key" ON "saml_request_ids"("sp_id", "request_id");

-- AddForeignKey
ALTER TABLE "saml_request_ids" ADD CONSTRAINT "saml_request_ids_sp_id_fkey" FOREIGN KEY ("sp_id") REFERENCES "saml_service_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

