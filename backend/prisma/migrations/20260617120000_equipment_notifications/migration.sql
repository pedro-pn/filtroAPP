-- Destinatários das notificações de calibração do módulo Equipamentos
CREATE TABLE "EquipmentNotificationRecipient" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentNotificationRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentNotificationRecipient_email_key" ON "EquipmentNotificationRecipient"("email");

-- Configuração (singleton) dos e-mails de calibração
CREATE TABLE "EquipmentNotificationConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "milestoneDays" INTEGER[] DEFAULT ARRAY[30, 15, 7],
    "notifyOnDueDay" BOOLEAN NOT NULL DEFAULT true,
    "repeatExpired" BOOLEAN NOT NULL DEFAULT true,
    "repeatGapDays" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentNotificationConfig_pkey" PRIMARY KEY ("id")
);
