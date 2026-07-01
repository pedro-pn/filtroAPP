-- Peso de cada serviço previsto no cálculo de avanço do projeto (D-3: RDO ponderado por serviço).
ALTER TABLE "ProjectPlannedService" ADD COLUMN "weight" DECIMAL(6,2) NOT NULL DEFAULT 1;
