ALTER TABLE "login_sessions" ADD COLUMN "satisfied_acr" TEXT,
ADD COLUMN "amr" TEXT[] DEFAULT ARRAY[]::TEXT[];
