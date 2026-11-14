-- One row per one-off data task run at start-up, so it can resume after a
-- restart and skip once done. First user: AdminEventPurgeService, which
-- redacts the secrets older admin_events rows recorded in plaintext.
--
-- The redaction itself is not done here: it walks admin_events in batches
-- (a single UPDATE could rewrite a huge table in one transaction), and it
-- applies the same TypeScript redaction new events go through.

-- CreateTable
CREATE TABLE "maintenance_tasks" (
    "id" TEXT NOT NULL,
    "completed_version" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT,
    "cursor_version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_tasks_pkey" PRIMARY KEY ("id")
);
