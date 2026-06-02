-- Add notification opt-out for signature reminders.
ALTER TABLE "User"
  ADD COLUMN "notifySignatureRemindersByEmail" BOOLEAN NOT NULL DEFAULT true;

-- Store reusable signature links and reminder delivery state.
ALTER TABLE "ReportSignature"
  ADD COLUMN "tokenEncrypted" TEXT,
  ADD COLUMN "tokenIv" TEXT,
  ADD COLUMN "tokenAuthTag" TEXT,
  ADD COLUMN "lastReminderAt" TIMESTAMP(3),
  ADD COLUMN "reminderClaimedAt" TIMESTAMP(3),
  ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ReportSignature_status_lastReminderAt_reminderClaimedAt_idx"
  ON "ReportSignature"("status", "lastReminderAt", "reminderClaimedAt");
