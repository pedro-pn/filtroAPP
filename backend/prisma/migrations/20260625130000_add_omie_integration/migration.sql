-- Integração Omie: projetos (cache), categorias, compras (contas a pagar) e log de sincronização

CREATE TABLE "OmieProject" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "osNumber" TEXT,
    "nome" TEXT,
    "inativo" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieProject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OmieProject_codigo_key" ON "OmieProject"("codigo");
CREATE INDEX "OmieProject_osNumber_idx" ON "OmieProject"("osNumber");
CREATE INDEX "OmieProject_projectId_idx" ON "OmieProject"("projectId");

CREATE TABLE "OmieCategory" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmieCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OmieCategory_codigo_key" ON "OmieCategory"("codigo");

CREATE TABLE "OmiePurchase" (
    "id" TEXT NOT NULL,
    "omieId" TEXT NOT NULL,
    "codigoProjeto" TEXT,
    "projectId" TEXT,
    "osNumber" TEXT,
    "valor" DECIMAL(14,2),
    "statusTitulo" TEXT,
    "categoriaCodigo" TEXT,
    "categoriaDescricao" TEXT,
    "fornecedorCodigo" TEXT,
    "numeroDocumento" TEXT,
    "numeroDocumentoFiscal" TEXT,
    "origem" TEXT,
    "dataEmissao" TIMESTAMP(3),
    "dataVencimento" TIMESTAMP(3),
    "dataPrevisao" TIMESTAMP(3),
    "linkStatus" TEXT NOT NULL DEFAULT 'LINKED',
    "rawPayload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OmiePurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OmiePurchase_omieId_key" ON "OmiePurchase"("omieId");
CREATE INDEX "OmiePurchase_projectId_idx" ON "OmiePurchase"("projectId");
CREATE INDEX "OmiePurchase_codigoProjeto_idx" ON "OmiePurchase"("codigoProjeto");
CREATE INDEX "OmiePurchase_categoriaCodigo_idx" ON "OmiePurchase"("categoriaCodigo");
CREATE INDEX "OmiePurchase_statusTitulo_idx" ON "OmiePurchase"("statusTitulo");

CREATE TABLE "IntegrationSyncRun" (
    "id" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "scope" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsWritten" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "summary" JSONB,
    "triggeredBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IntegrationSyncRun_integration_startedAt_idx" ON "IntegrationSyncRun"("integration", "startedAt");
CREATE INDEX "IntegrationSyncRun_status_idx" ON "IntegrationSyncRun"("status");

ALTER TABLE "OmieProject" ADD CONSTRAINT "OmieProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OmiePurchase" ADD CONSTRAINT "OmiePurchase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
