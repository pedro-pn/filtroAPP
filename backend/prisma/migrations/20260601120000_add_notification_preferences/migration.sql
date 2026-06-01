ALTER TABLE "User"
ADD COLUMN "notifyReportsByEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifySignaturesByEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "notifySurveyRemindersByEmail" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "NotificationPreferenceToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationPreferenceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationPreferenceToken_tokenHash_key" ON "NotificationPreferenceToken"("tokenHash");
CREATE INDEX "NotificationPreferenceToken_userId_usedAt_expiresAt_idx" ON "NotificationPreferenceToken"("userId", "usedAt", "expiresAt");
CREATE INDEX "NotificationPreferenceToken_expiresAt_idx" ON "NotificationPreferenceToken"("expiresAt");

ALTER TABLE "NotificationPreferenceToken"
ADD CONSTRAINT "NotificationPreferenceToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
