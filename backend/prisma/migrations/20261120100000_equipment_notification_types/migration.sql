-- Preserva os avisos de calibração existentes; novos cadastros exigem adesão.
ALTER TABLE "EquipmentNotificationRecipient"
  ADD COLUMN "notifyCalibrationReminders" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyCalibrationUpdated" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyEquipmentCreated" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "EquipmentNotificationConfig"
  ADD COLUMN "notifyOnEquipmentCreated" BOOLEAN NOT NULL DEFAULT false;
