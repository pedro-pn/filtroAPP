-- O incremental de /projetos deve detectar criação, correção e remoção do
-- vínculo público, inclusive quando a alteração não passa pelo Prisma Client.
CREATE FUNCTION touch_project_prisma_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  project_ids TEXT[] := '{}';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(OLD."sourceSystem", OLD."tenantId", OLD."environment", OLD."projectId", OLD."prismaMissionId", OLD."number", OLD."numberScope")
       IS NOT DISTINCT FROM
       ROW(NEW."sourceSystem", NEW."tenantId", NEW."environment", NEW."projectId", NEW."prismaMissionId", NEW."number", NEW."numberScope") THEN
      RETURN NULL;
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF OLD."sourceSystem" = 'prismaCRM' AND OLD."environment" = 'production' THEN
      project_ids := array_append(project_ids, OLD."projectId");
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW."sourceSystem" = 'prismaCRM' AND NEW."environment" = 'production' THEN
      project_ids := array_append(project_ids, NEW."projectId");
    END IF;
  END IF;
  UPDATE "Project" SET "updatedAt" = GREATEST("updatedAt" + INTERVAL '1 millisecond', clock_timestamp() AT TIME ZONE 'UTC')
    WHERE "id" = ANY(project_ids);
  RETURN NULL;
END;
$$;

CREATE TRIGGER project_prisma_mapping_watermark
AFTER INSERT OR UPDATE OR DELETE ON "CrmProjectMapping"
FOR EACH ROW EXECUTE FUNCTION touch_project_prisma_mapping();
