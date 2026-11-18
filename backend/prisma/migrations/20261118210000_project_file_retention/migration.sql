-- LGPD: marca da remoção de fotos/anexos dos RDOs 10 anos após o encerramento do projeto.
ALTER TABLE "Project" ADD COLUMN "filesRetentionPurgedAt" TIMESTAMP(3);
