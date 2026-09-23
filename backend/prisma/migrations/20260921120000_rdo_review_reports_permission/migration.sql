CREATE TYPE "RdoExtraPermission" AS ENUM ('REVIEW_REPORTS');

ALTER TABLE "User"
ADD COLUMN "rdoExtraPermissions" "RdoExtraPermission"[] NOT NULL DEFAULT ARRAY[]::"RdoExtraPermission"[];
