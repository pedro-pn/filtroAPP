-- Um mês sem envios concluídos não deve ter uma data de envio.
ALTER TABLE "AllocationReportDelivery" ALTER COLUMN "sentAt" DROP NOT NULL;
ALTER TABLE "AllocationReportDelivery" ALTER COLUMN "sentAt" DROP DEFAULT;
