DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ReportType'
      AND e.enumlabel = 'RCP'
  ) THEN
    ALTER TYPE "ReportType" RENAME VALUE 'RCP' TO 'RCPU';
  END IF;
END $$;
