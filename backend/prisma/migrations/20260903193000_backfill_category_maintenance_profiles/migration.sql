-- Associa os perfis existentes às categorias reais do módulo. UFP e ULQ usam
-- o perfil regular como padrão; pneus e diesel continuam como exceções.
UPDATE "EquipmentCategory" AS category
SET "maintenanceProfileId" = profile."id"
FROM (
  VALUES
    ('unit:Unidade de filtragem', 'UFI'),
    ('unit:Unidade de Teste Hidrostático', 'UTH'),
    ('unit:Unidade de Flushing', 'UFP_REGULAR'),
    ('unit:Unidade de desidratação', 'UTO'),
    ('unidades_de_bomba_pneumatica', 'UBP'),
    ('unit:Unidade de Limpeza Química', 'ULQ_REGULAR'),
    ('transformer', 'TRO'),
    ('unidade_de_compressor', 'CMR')
) AS mapping("categoryKey", "profileKey")
JOIN "MaintenanceProfile" AS profile
  ON profile."key" = mapping."profileKey"
WHERE category."maintenanceProfileId" IS NULL
  AND category."systemKey" = mapping."categoryKey";

-- Compatibilidade com categorias criadas manualmente usando a sigla como chave.
UPDATE "EquipmentCategory" AS category
SET "maintenanceProfileId" = profile."id"
FROM (
  VALUES
    ('UFI', 'UFI'),
    ('UTH', 'UTH'),
    ('UFP', 'UFP_REGULAR'),
    ('UTO', 'UTO'),
    ('UBP', 'UBP'),
    ('ULQ', 'ULQ_REGULAR'),
    ('TRO', 'TRO'),
    ('CMR', 'CMR')
) AS mapping("categoryKey", "profileKey")
JOIN "MaintenanceProfile" AS profile
  ON profile."key" = mapping."profileKey"
WHERE category."maintenanceProfileId" IS NULL
  AND UPPER(category."systemKey") = mapping."categoryKey";
