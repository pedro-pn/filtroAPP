-- Página pública do QR code: token estável por item de catálogo (todos os itens existentes recebem um token no deploy).
ALTER TABLE "RomaneioCatalogItem" ADD COLUMN "publicToken" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;
CREATE UNIQUE INDEX "RomaneioCatalogItem_publicToken_key" ON "RomaneioCatalogItem"("publicToken");

-- Acesso por documento na página do QR do equipamento.
ALTER TABLE "CompanyEquipment" ADD COLUMN "qrDocumentAccess" JSONB NOT NULL DEFAULT '{}';
