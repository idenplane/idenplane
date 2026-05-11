-- CreateTable
CREATE TABLE "upgrade_audit_log" (
    "id" TEXT NOT NULL,
    "from_version" TEXT NOT NULL,
    "to_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "initiated_by" TEXT,
    "backup_id" TEXT,
    "rollback_from_version" TEXT,
    "error_message" TEXT,
    "checks_passed" JSONB,
    "checks_failed" JSONB,
    "steps_completed" JSONB,
    "steps_failed" JSONB,
    "metadata" JSONB,

    CONSTRAINT "upgrade_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upgrade_audit_log_status_idx" ON "upgrade_audit_log"("status");

-- CreateIndex
CREATE INDEX "upgrade_audit_log_from_version_idx" ON "upgrade_audit_log"("from_version");

-- CreateIndex
CREATE INDEX "upgrade_audit_log_to_version_idx" ON "upgrade_audit_log"("to_version");

-- CreateIndex
CREATE INDEX "upgrade_audit_log_started_at_idx" ON "upgrade_audit_log"("started_at");
