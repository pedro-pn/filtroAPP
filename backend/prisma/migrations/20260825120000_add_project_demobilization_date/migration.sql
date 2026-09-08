-- Data de desmobilização da missão, preenchida no cronograma depois do fato.
-- Com mobilização e desmobilização preenchidas, a janela passa a alocar os dias de ponto que não
-- têm etiqueta reconhecida nem RDO. Enquanto a desmobilização estiver vazia a regra segue
-- conservadora e esses dias continuam indo para a fila de pendências.
ALTER TABLE "Project"
  ADD COLUMN "demobilizationDate" TIMESTAMP(3);
