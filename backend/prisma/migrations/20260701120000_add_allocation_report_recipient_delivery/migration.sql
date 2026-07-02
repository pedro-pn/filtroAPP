CREATE TABLE "AllocationReportRecipientDelivery" (
    "id" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLAIMED',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationReportRecipientDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AllocationReportRecipientDelivery_yearMonth_email_key" ON "AllocationReportRecipientDelivery"("yearMonth", "email");
CREATE INDEX "AllocationReportRecipientDelivery_yearMonth_idx" ON "AllocationReportRecipientDelivery"("yearMonth");
CREATE INDEX "AllocationReportRecipientDelivery_status_idx" ON "AllocationReportRecipientDelivery"("status");
CREATE INDEX "AllocationReportRecipientDelivery_sentAt_idx" ON "AllocationReportRecipientDelivery"("sentAt");
