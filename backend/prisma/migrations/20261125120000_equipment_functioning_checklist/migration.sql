ALTER TABLE "EquipmentCategory" ADD COLUMN "functioningChecklist" JSONB NOT NULL DEFAULT '{"format":"MONTHLY","items":[]}';
ALTER TABLE "CompanyEquipment" ADD COLUMN "functioningChecklist" JSONB;

-- Aplica os novos padrões a todos os documentos existentes. Outros acessos
-- (por exemplo, certificado) continuam conforme a configuração anterior.
UPDATE "CompanyEquipment" e
SET "qrDocumentAccess" = (e."qrDocumentAccess" - 'manual' - 'datasheet' - 'checklist' - 'maintenance')
  || COALESCE((
    SELECT jsonb_object_agg('doc:' || a.id, 'HIDDEN'::text)
    FROM "EquipmentAttachment" a
    WHERE a."equipmentId" = e.id AND a.kind = 'DOCUMENT'
  ), '{}'::jsonb);
