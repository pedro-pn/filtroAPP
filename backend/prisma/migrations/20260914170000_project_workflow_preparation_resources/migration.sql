CREATE TABLE "ProjectWorkflowPreparationItemCheck" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "ProjectWorkflowChecklistStatus" NOT NULL DEFAULT 'PENDING',
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectWorkflowPreparationItemCheck_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectWorkflowPreparationItemCheck_projectId_itemType_itemId_key_key"
ON "ProjectWorkflowPreparationItemCheck"("projectId", "itemType", "itemId", "key");

CREATE INDEX "ProjectWorkflowPreparationItemCheck_projectId_itemType_itemId_idx"
ON "ProjectWorkflowPreparationItemCheck"("projectId", "itemType", "itemId");

CREATE INDEX "ProjectWorkflowPreparationItemCheck_updatedByUserId_idx"
ON "ProjectWorkflowPreparationItemCheck"("updatedByUserId");

ALTER TABLE "ProjectWorkflowPreparationItemCheck"
ADD CONSTRAINT "ProjectWorkflowPreparationItemCheck_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "ProjectWorkflow"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkflowPreparationItemCheck"
ADD CONSTRAINT "ProjectWorkflowPreparationItemCheck_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve completed equipment confirmations from the former category-wide checklist.
WITH selected_equipment AS (
    SELECT DISTINCT
        plan."projectId",
        selected."equipmentId"
    FROM "ProjectWorkflowEquipmentCategoryPlan" plan
    CROSS JOIN LATERAL (
        SELECT jsonb_array_elements_text(plan."equipmentIds") AS "equipmentId"
        WHERE jsonb_typeof(plan."equipmentIds") = 'array' AND jsonb_array_length(plan."equipmentIds") > 0
        UNION
        SELECT equipment."id" AS "equipmentId"
        FROM "CompanyEquipment" equipment
        WHERE equipment."categoryId" = plan."categoryId"
          AND equipment."isActive" = true
          AND (jsonb_typeof(plan."equipmentIds") <> 'array' OR jsonb_array_length(plan."equipmentIds") = 0)
    ) selected
), equipment_checks AS (
    SELECT 'TESTED' AS "key", 'D15_EQUIPMENT_TESTED' AS "legacyKey"
    UNION ALL
    SELECT 'ACCESSORIES_SEPARATED', 'D15_EQUIPMENT_ACCESSORIES_SEPARATED'
)
INSERT INTO "ProjectWorkflowPreparationItemCheck" (
    "id", "projectId", "itemType", "itemId", "key", "status", "updatedByUserId", "createdAt", "updatedAt"
)
SELECT
    'pwpic-' || md5(selected."projectId" || ':EQUIPMENT:' || selected."equipmentId" || ':' || checks."key"),
    selected."projectId",
    'EQUIPMENT',
    selected."equipmentId",
    checks."key",
    'DONE'::"ProjectWorkflowChecklistStatus",
    legacy."updatedByUserId",
    COALESCE(legacy."updatedAt", CURRENT_TIMESTAMP),
    COALESCE(legacy."updatedAt", CURRENT_TIMESTAMP)
FROM selected_equipment selected
CROSS JOIN equipment_checks checks
JOIN "ProjectWorkflowChecklist" legacy
  ON legacy."projectId" = selected."projectId"
 AND legacy."key" = checks."legacyKey"
 AND legacy."status" IN ('DONE', 'NOT_APPLICABLE')
ON CONFLICT ("projectId", "itemType", "itemId", "key") DO NOTHING;

-- Preserve material separation confirmations for every item stored in the D-30 plan.
WITH selected_materials AS (
    SELECT
        workflow."projectId",
        item.value ->> 'id' AS "itemId",
        item.value ->> 'type' AS "itemType"
    FROM "ProjectWorkflow" workflow
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(workflow."supplyPlan") = 'array' THEN workflow."supplyPlan" ELSE '[]'::jsonb END
    ) item(value)
    WHERE COALESCE(item.value ->> 'id', '') <> ''
)
INSERT INTO "ProjectWorkflowPreparationItemCheck" (
    "id", "projectId", "itemType", "itemId", "key", "status", "updatedByUserId", "createdAt", "updatedAt"
)
SELECT
    'pwpic-' || md5(material."projectId" || ':MATERIAL:' || material."itemId" || ':SEPARATED'),
    material."projectId",
    'MATERIAL',
    material."itemId",
    'SEPARATED',
    'DONE'::"ProjectWorkflowChecklistStatus",
    legacy."updatedByUserId",
    COALESCE(legacy."updatedAt", CURRENT_TIMESTAMP),
    COALESCE(legacy."updatedAt", CURRENT_TIMESTAMP)
FROM selected_materials material
JOIN LATERAL (
    SELECT checklist."updatedByUserId", checklist."updatedAt"
    FROM "ProjectWorkflowChecklist" checklist
    WHERE checklist."projectId" = material."projectId"
      AND checklist."status" IN ('DONE', 'NOT_APPLICABLE')
      AND checklist."key" IN (
          'D15_MATERIALS_SEPARATED',
          CASE WHEN material."itemType" = 'FILTRO' THEN 'D15_MATERIALS_FILTERS_SEPARATED' ELSE 'D15_MATERIALS_CHEMICALS_SEPARATED' END
      )
    ORDER BY checklist."updatedAt" DESC
    LIMIT 1
) legacy ON true
ON CONFLICT ("projectId", "itemType", "itemId", "key") DO NOTHING;
