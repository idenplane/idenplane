-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "post_logout_redirect_uris" TEXT[] DEFAULT ARRAY[]::TEXT[];
