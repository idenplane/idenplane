-- CreateEnum
CREATE TYPE "TokenEndpointAuthMethod" AS ENUM ('client_secret_basic', 'client_secret_post', 'none', 'tls_client_auth', 'self_signed_tls_client_auth');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "tls_client_auth_san_dns" TEXT,
ADD COLUMN     "tls_client_auth_san_email" TEXT,
ADD COLUMN     "tls_client_auth_san_ip" TEXT,
ADD COLUMN     "tls_client_auth_san_uri" TEXT,
ADD COLUMN     "tls_client_auth_subject_dn" TEXT,
ADD COLUMN     "tls_client_certificate_bound_access_tokens" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "token_endpoint_auth_method" "TokenEndpointAuthMethod";

-- AlterTable
ALTER TABLE "realms" ADD COLUMN     "mtls_client_auth_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mtls_trust_global_anchors" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "client_tls_certificates" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "x5t_s256" TEXT NOT NULL,
    "certificate_pem" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "not_before" TIMESTAMP(3) NOT NULL,
    "not_after" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_tls_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "realm_tls_trust_anchors" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "certificate_pem" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "x5t_s256" TEXT NOT NULL,
    "not_after" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realm_tls_trust_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tls_revoked_certificates" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "x5t_s256" TEXT,
    "issuer_dn" TEXT,
    "serial_number" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tls_revoked_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_tls_certificates_realm_id_idx" ON "client_tls_certificates"("realm_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_tls_certificates_client_id_x5t_s256_key" ON "client_tls_certificates"("client_id", "x5t_s256");

-- CreateIndex
CREATE UNIQUE INDEX "realm_tls_trust_anchors_realm_id_x5t_s256_key" ON "realm_tls_trust_anchors"("realm_id", "x5t_s256");

-- CreateIndex
CREATE INDEX "tls_revoked_certificates_realm_id_x5t_s256_idx" ON "tls_revoked_certificates"("realm_id", "x5t_s256");

-- CreateIndex
CREATE INDEX "tls_revoked_certificates_realm_id_serial_number_idx" ON "tls_revoked_certificates"("realm_id", "serial_number");

-- AddForeignKey
ALTER TABLE "client_tls_certificates" ADD CONSTRAINT "client_tls_certificates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_tls_certificates" ADD CONSTRAINT "client_tls_certificates_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "realm_tls_trust_anchors" ADD CONSTRAINT "realm_tls_trust_anchors_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tls_revoked_certificates" ADD CONSTRAINT "tls_revoked_certificates_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A deny-list entry names a certificate by thumbprint, by issuer and serial, or both.
ALTER TABLE "tls_revoked_certificates" ADD CONSTRAINT "tls_revoked_certificates_identifies_check" CHECK ("x5t_s256" IS NOT NULL OR ("issuer_dn" IS NOT NULL AND "serial_number" IS NOT NULL));
