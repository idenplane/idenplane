-- Admin console MFA (0.11.0).
--
-- One server-wide row of admin security settings. The migration writes no
-- row, and no row means "MFA not required": an upgraded install keeps
-- signing in as before. The first-boot seed of a new install writes the row
-- with mfa_required = true. ADMIN_MFA_REQUIRED overrides it.

-- CreateTable
CREATE TABLE "admin_security_policy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mfa_required" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_security_policy_pkey" PRIMARY KEY ("id"),
    -- A single row.
    CONSTRAINT "admin_security_policy_single_row" CHECK ("id" = 1)
);
