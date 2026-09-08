-- Diagnóstico: item (ex.: produto químico) que saiu no romaneio de saída e não
-- aparece na lista "Itens retornando" do romaneio de entrada.
--
-- Uso:
--   docker compose --env-file backend/.env.production -f docker-compose.prod.yml exec -T postgres \
--     psql -U postgres -d filtrovali -v ON_ERROR_STOP=1 -v missao='5797' \
--     < deploy/diagnostico-romaneio-retorno.sql
--
-- Somente leitura: nenhuma query aqui altera dados.

\set QUIET on
\pset pager off
\set QUIET off

\echo '== 1) Missões com esse código (checar duplicidade pendente x oficial) =='
SELECT id, code, name, "isActive", "registrationPending", "createdAt"
FROM "Project"
WHERE code = :'missao';

\echo '== 2) Romaneios da missão =='
SELECT r.id, r.type, r."romaneioDate"::date AS data, r."driverName", r."createdAt"
FROM "Romaneio" r
JOIN "Project" p ON p.id = r."projectId"
WHERE p.code = :'missao'
ORDER BY r."romaneioDate", r."createdAt";

\echo '== 3) Itens gravados em cada romaneio da missão =='
SELECT r.type,
       r."romaneioDate"::date AS data,
       i."itemCode",
       i."itemName",
       i."categoryName",
       i.quantity,
       i."unitLabel",
       i."isExtra",
       ci."sourceType" AS origem_catalogo,
       ci."isActive"   AS catalogo_ativo
FROM "RomaneioItem" i
JOIN "Romaneio" r ON r.id = i."romaneioId"
JOIN "Project" p ON p.id = r."projectId"
LEFT JOIN "RomaneioCatalogItem" ci ON ci.id = i."catalogItemId"
WHERE p.code = :'missao'
ORDER BY r."romaneioDate", r."createdAt", i."sortOrder";

\echo '== 4) Saldo retornável (é exatamente o que a tela de entrada lista: saldo > 0) =='
-- A chave reproduz romaneioItemReturnKey (backend/src/routes/resources/romaneios.js).
SELECT COALESCE(
         'catalog:' || i."catalogItemId",
         concat_ws('|', 'snapshot',
                   lower(trim(COALESCE(i."itemCode", ''))),
                   lower(trim(i."itemName")),
                   lower(trim(i."categoryName")),
                   i.kind::text,
                   i."measureType"::text,
                   lower(trim(i."unitLabel")))
       ) AS chave,
       max(i."itemCode")     AS codigo,
       max(i."itemName")     AS item,
       max(i."categoryName") AS categoria,
       max(i."unitLabel")    AS unidade,
       sum(CASE WHEN r.type = 'INBOUND' THEN -i.quantity ELSE i.quantity END) AS saldo_para_retorno
FROM "RomaneioItem" i
JOIN "Romaneio" r ON r.id = i."romaneioId"
JOIN "Project" p ON p.id = r."projectId"
WHERE p.code = :'missao'
  AND i."isExtra" = false
GROUP BY 1
ORDER BY 2, 3;

\echo '== 5) Produtos químicos do Estoque fora do catálogo do Romaneio (só kg sincroniza) =='
SELECT id, code, name, "unitLabel", "isActive"
FROM "StockItem"
WHERE type = 'PRODUTO_QUIMICO'
  AND ("unitLabel" <> 'kg' OR "isActive" = false)
ORDER BY code, name;

\echo '== 6) Movimentações de estoque da missão (saída/devolução, com e sem romaneio) =='
SELECT m.date::date AS data,
       si.code AS item_code,
       si.name AS item,
       m.type,
       m.reason,
       m.quantity,
       si."unitLabel",
       m."romaneioId"
FROM "StockMovement" m
JOIN "StockItem" si ON si.id = m."itemId"
JOIN "Project" p ON p.id = m."projectId"
WHERE p.code = :'missao'
ORDER BY m.date, m."createdAt";

\echo '== 7) Rascunhos de romaneio de ENTRADA (podem sobrescrever a lista antes da correção) =='
SELECT d.id,
       COALESCE(u.email, u.username) AS usuario,
       COALESCE(p.code, d.payload->>'projectCode') AS missao,
       d."reportDate" AS data_romaneio,
       jsonb_array_length(COALESCE(d.payload->'selectedItems', '[]'::jsonb)) AS qtd_itens,
       d."updatedAt"
FROM "ReportDraft" d
JOIN "User" u ON u.id = d."userId"
LEFT JOIN "Project" p ON p.id = d."projectId"
WHERE d.payload->>'__module' = 'romaneio'
  AND d.payload->>'romaneioType' = 'INBOUND'
ORDER BY d."updatedAt" DESC;
