-- AlterTable
ALTER TABLE "authorization_codes" ADD COLUMN     "amr" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "satisfied_acr" TEXT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "amr" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "satisfied_acr" TEXT;
