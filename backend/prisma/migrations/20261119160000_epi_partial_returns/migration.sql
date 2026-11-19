-- Permite devoluções assinadas sucessivas da mesma entrega, mantendo no máximo
-- uma devolução pendente ativa. Não altera entregas nem evidências existentes.
CREATE UNIQUE INDEX "EpiRecord_pendingReturnSourceRecordId_key"
  ON "EpiRecord"("returnSourceRecordId")
  WHERE "returnSourceRecordId" IS NOT NULL AND "pendingReturn" = true AND "archivedAt" IS NULL;

DROP INDEX "EpiRecord_openReturnSourceRecordId_key";
