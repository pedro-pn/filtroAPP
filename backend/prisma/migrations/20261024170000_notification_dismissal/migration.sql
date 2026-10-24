-- A exclusão é individual: mantém o evento disponível para as demais contas.
ALTER TABLE "NotificationRead" ADD COLUMN "dismissedAt" TIMESTAMP(3);
