-- AlterTable
ALTER TABLE "realms" ADD COLUMN "login_theme" VARCHAR(50) NOT NULL DEFAULT 'idenplane';
ALTER TABLE "realms" ADD COLUMN "account_theme" VARCHAR(50) NOT NULL DEFAULT 'idenplane';
ALTER TABLE "realms" ADD COLUMN "email_theme" VARCHAR(50) NOT NULL DEFAULT 'idenplane';

-- Migrate existing theme_name to per-type fields
UPDATE "realms" SET login_theme = theme_name, account_theme = theme_name, email_theme = theme_name;
