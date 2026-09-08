ALTER TABLE "PontoSyncState"
  ADD COLUMN "dataRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "targetDataRevision" INTEGER;
