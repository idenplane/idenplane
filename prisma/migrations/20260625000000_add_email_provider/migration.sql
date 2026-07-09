-- AlterTable: add email provider fields to realms
-- emailProvider defaults to 'smtp' so existing realms continue working unchanged.
ALTER TABLE "realms" ADD COLUMN "email_provider" TEXT NOT NULL DEFAULT 'smtp';
ALTER TABLE "realms" ADD COLUMN "email_provider_config" JSONB;
