ALTER TABLE "ParticleCounter"
ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'CONTADOR DE PARTICULAS';

CREATE INDEX IF NOT EXISTS "ParticleCounter_category_idx" ON "ParticleCounter"("category");
