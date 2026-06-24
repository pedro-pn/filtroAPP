-- Motor de custo: perfis (operador/auxiliar) + parâmetros versionados (campos "amarelos")

CREATE TABLE "CostProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CostProfile_key_key" ON "CostProfile"("key");

CREATE TABLE "CostParameterSet" (
    "id" TEXT NOT NULL,
    "costProfileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "params" JSONB NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostParameterSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CostParameterSet_costProfileId_version_key" ON "CostParameterSet"("costProfileId", "version");
CREATE INDEX "CostParameterSet_costProfileId_idx" ON "CostParameterSet"("costProfileId");

ALTER TABLE "CostParameterSet" ADD CONSTRAINT "CostParameterSet_costProfileId_fkey" FOREIGN KEY ("costProfileId") REFERENCES "CostProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carga inicial: Operador
WITH op AS (
  INSERT INTO "CostProfile" ("id", "key", "label", "updatedAt")
  VALUES (gen_random_uuid()::text, 'operador', 'Operador de Equipamentos', CURRENT_TIMESTAMP)
  RETURNING id
)
INSERT INTO "CostParameterSet" ("id", "costProfileId", "version", "params", "note")
SELECT gen_random_uuid()::text, id, 1,
  '{"salarioBase":3080.33,"salarioMinimo":1621,"cargaHoraria":220,"diasUteis":22,"insalubridade":324.2,"periculosidadePct":0.3,"produtividadePct":0.15,"transferenciaPct":0.3,"he70LimiteHoras":30,"he70Pct":0.7,"he100Pct":1,"fgtsPct":0.08,"inssPatronalPct":0.1,"multaPct":0.4,"beneficios":{"planoSaude":800,"valeAlimentacao":600,"odonto":16,"seguroVida":50,"cursos":300}}'::jsonb,
  'Carga inicial da planilha custo_operador'
FROM op;

-- Carga inicial: Auxiliar
WITH aux AS (
  INSERT INTO "CostProfile" ("id", "key", "label", "updatedAt")
  VALUES (gen_random_uuid()::text, 'auxiliar', 'Auxiliar de Operador', CURRENT_TIMESTAMP)
  RETURNING id
)
INSERT INTO "CostParameterSet" ("id", "costProfileId", "version", "params", "note")
SELECT gen_random_uuid()::text, id, 1,
  '{"salarioBase":2290.47,"salarioMinimo":1621,"cargaHoraria":220,"diasUteis":22,"insalubridade":324.2,"periculosidadePct":0.3,"produtividadePct":0.05,"transferenciaPct":0.1,"he70LimiteHoras":30,"he70Pct":0.7,"he100Pct":1,"fgtsPct":0.08,"inssPatronalPct":0.1,"multaPct":0.4,"beneficios":{"planoSaude":800,"valeAlimentacao":600,"odonto":16,"seguroVida":50,"cursos":300}}'::jsonb,
  'Carga inicial da planilha custo_auxiliar'
FROM aux;
