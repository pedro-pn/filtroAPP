CREATE TABLE "OmieInvoice" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "codigoProjeto" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "serie" TEXT,
    "dataEmissao" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "clienteNome" TEXT,
    "clienteCnpj" TEXT,
    "receiptStatus" TEXT NOT NULL,
    "installmentCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OmieInvoice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OmieInvoice_codigoProjeto_dataEmissao_idx" ON "OmieInvoice"("codigoProjeto", "dataEmissao");
