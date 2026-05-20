-- CreateTable: installed_plugins
-- Tracks plugins installed in the Idenplane instance.
CREATE TABLE "installed_plugins" (
    "id"           TEXT        NOT NULL,
    "name"         TEXT        NOT NULL,
    "version"      TEXT        NOT NULL,
    "type"         TEXT        NOT NULL,
    "enabled"      BOOLEAN     NOT NULL DEFAULT true,
    "config"       JSONB,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installed_plugins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique plugin name
CREATE UNIQUE INDEX "installed_plugins_name_key" ON "installed_plugins"("name");
