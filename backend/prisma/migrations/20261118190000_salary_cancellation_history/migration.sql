-- Tag the existing live Conecta projection before switching to immutable revisions.
UPDATE "CostParameterSet" p
SET params = p.params || jsonb_build_object('salaryReference', jsonb_build_object(
  'id', a."externalId", 'revision', a.revision, 'status', a.data->>'status',
  'supersedesId', a.data->'supersedesId'))
FROM "ConectaRhAggregate" a
WHERE a."aggregateType" = 'job_role_salary' AND a."localId" = p.id
  AND a.status = 'APPLIED' AND a.data->>'status' = 'ACTIVE';

-- Previously applied cancellations deleted their local projection. Materialize
-- a tombstone so deployment also repairs already affected cargos, without replay
-- or reactivation of the cancelled salary.
INSERT INTO "CostProfile" (id, key, label, "jobRoleId", "updatedAt")
SELECT DISTINCT 'cp_conecta:' || j.id, 'role:' || j.id, j.name, j.id, CURRENT_TIMESTAMP
FROM "ConectaRhAggregate" a
JOIN "ConectaRhAggregate" r ON r."companyId" = a."companyId"
  AND r."aggregateType" = 'job_role' AND r."externalId" = a.data->>'jobRoleId'
JOIN "JobRole" j ON j.id = r."localId"
WHERE a."aggregateType" = 'job_role_salary' AND a.status = 'APPLIED'
  AND a.data->>'status' = 'CANCELLED'
ON CONFLICT ("jobRoleId") DO NOTHING;

WITH cancelled AS (
  SELECT a.*, p.id AS profile_id,
    COALESCE((SELECT MAX(s.version) FROM "CostParameterSet" s WHERE s."costProfileId" = p.id), 0) AS max_version,
    SUM(a.revision) OVER (PARTITION BY p.id) AS source_revisions,
    ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY a.id) AS ordinal
  FROM "ConectaRhAggregate" a
  JOIN "ConectaRhAggregate" r ON r."companyId" = a."companyId"
    AND r."aggregateType" = 'job_role' AND r."externalId" = a.data->>'jobRoleId'
  JOIN "CostProfile" p ON p."jobRoleId" = r."localId"
  WHERE a."aggregateType" = 'job_role_salary' AND a.status = 'APPLIED'
    AND a.data->>'status' = 'CANCELLED'
    AND NOT EXISTS (SELECT 1 FROM "CostParameterSet" s WHERE s."costProfileId" = p.id
      AND s.id NOT LIKE 'conecta:%' AND s."createdAt" > a."lastAttemptAt"
      AND s."effectiveDate" >= (a.data->>'effectiveDate')::date
      AND s.params->'salarioBase' IS NOT NULL AND s.params->'salarioBase' <> 'null'::jsonb)
), inserted AS (
  INSERT INTO "CostParameterSet" (id, "costProfileId", version, "effectiveDate", params, note)
  SELECT 'conecta:' || a.id || ':' || a.revision, a.profile_id,
    (a.max_version + a.source_revisions + a.ordinal)::integer, (a.data->>'effectiveDate')::date,
    COALESCE((SELECT s.params FROM "CostParameterSet" s WHERE s."costProfileId" = a.profile_id
      AND s."effectiveDate" <= (a.data->>'effectiveDate')::date
      ORDER BY s."effectiveDate" DESC, s.version DESC LIMIT 1), '{}'::jsonb)
      || jsonb_build_object('salarioBase', NULL, 'salaryReference', jsonb_build_object(
        'id', a."externalId", 'revision', a.revision, 'status', 'CANCELLED', 'supersedesId', a.data->'supersedesId')),
    'Referência salarial cancelada pelo Conecta; regularização necessária.'
  FROM cancelled a
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
UPDATE "ConectaRhAggregate" a SET "localId" = i.id
FROM inserted i WHERE i.id = 'conecta:' || a.id || ':' || a.revision;
