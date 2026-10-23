ALTER TYPE "PlannedMeasureUnit" ADD VALUE IF NOT EXISTS 'DIA';
ALTER TABLE "Project" ADD COLUMN "serviceCategory" TEXT NOT NULL DEFAULT 'SERVICE', ADD COLUMN "endDate" DATE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_serviceCategory_check" CHECK ("serviceCategory" IN ('SERVICE', 'RENTAL'));
ALTER TABLE "Project" ADD CONSTRAINT "Project_rental_dates_check" CHECK ("serviceCategory" <> 'RENTAL' OR "endDate" IS NULL OR "startDate" IS NULL OR "endDate" >= "startDate");
