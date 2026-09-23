CREATE TYPE "AcompanhamentoExtraPermission" AS ENUM ('VIEW_PROJECT_TAXES_AND_BILLING');

ALTER TABLE "User"
ADD COLUMN "acompanhamentoExtraPermissions" "AcompanhamentoExtraPermission"[] NOT NULL DEFAULT ARRAY[]::"AcompanhamentoExtraPermission"[];
