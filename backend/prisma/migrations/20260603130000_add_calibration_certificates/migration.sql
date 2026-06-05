CREATE TYPE "CalibrationEquipmentType" AS ENUM ('MANOMETER', 'PARTICLE_COUNTER');

CREATE TABLE "CalibrationCertificate" (
    "id" TEXT NOT NULL,
    "equipmentType" "CalibrationEquipmentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "storagePath" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "manometerId" TEXT,
    "particleCounterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalibrationCertificate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalibrationCertificate_publicToken_key" ON "CalibrationCertificate"("publicToken");
CREATE INDEX "CalibrationCertificate_manometerId_createdAt_idx" ON "CalibrationCertificate"("manometerId", "createdAt");
CREATE INDEX "CalibrationCertificate_particleCounterId_createdAt_idx" ON "CalibrationCertificate"("particleCounterId", "createdAt");

ALTER TABLE "CalibrationCertificate"
  ADD CONSTRAINT "CalibrationCertificate_manometerId_fkey"
  FOREIGN KEY ("manometerId") REFERENCES "Manometer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalibrationCertificate"
  ADD CONSTRAINT "CalibrationCertificate_particleCounterId_fkey"
  FOREIGN KEY ("particleCounterId") REFERENCES "ParticleCounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
