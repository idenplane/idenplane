-- Reverse-proxy / forward-auth mode (#1314).
-- Purely additive: two new tables, no change to any existing one, so an
-- instance that never configures a proxy application is unaffected.

-- CreateTable
CREATE TABLE "proxy_applications" (
    "id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "client_id" TEXT NOT NULL,
    "allowed_redirect_uris" TEXT[],
    "cookie_domain" TEXT NOT NULL,
    "cookie_ttl" INTEGER NOT NULL DEFAULT 28800,
    "user_header" TEXT NOT NULL DEFAULT 'X-Forwarded-User',
    "email_header" TEXT NOT NULL DEFAULT 'X-Forwarded-Email',
    "name_header" TEXT NOT NULL DEFAULT 'X-Forwarded-Preferred-Username',
    "groups_header" TEXT NOT NULL DEFAULT 'X-Forwarded-Groups',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proxy_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxy_sessions" (
    "id" TEXT NOT NULL,
    "proxy_application_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proxy_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proxy_applications_client_id_idx" ON "proxy_applications"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "proxy_applications_realm_id_slug_key" ON "proxy_applications"("realm_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "proxy_sessions_token_hash_key" ON "proxy_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "proxy_sessions_user_id_idx" ON "proxy_sessions"("user_id");

-- CreateIndex
CREATE INDEX "proxy_sessions_proxy_application_id_idx" ON "proxy_sessions"("proxy_application_id");

-- CreateIndex
CREATE INDEX "proxy_sessions_expires_at_idx" ON "proxy_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "proxy_applications" ADD CONSTRAINT "proxy_applications_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_applications" ADD CONSTRAINT "proxy_applications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_sessions" ADD CONSTRAINT "proxy_sessions_proxy_application_id_fkey" FOREIGN KEY ("proxy_application_id") REFERENCES "proxy_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_sessions" ADD CONSTRAINT "proxy_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

