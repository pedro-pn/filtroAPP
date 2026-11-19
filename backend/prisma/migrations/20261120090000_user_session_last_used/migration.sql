-- Spec 041: inatividade da sessão do navegador. Coluna nova e anulável (sessões
-- existentes começam sem valor e passam a ser marcadas no próximo uso).
ALTER TABLE "UserSession" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

CREATE INDEX "UserSession_lastUsedAt_idx" ON "UserSession"("lastUsedAt");
