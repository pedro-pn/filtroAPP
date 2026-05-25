ALTER TABLE "Unit" ALTER COLUMN "category" TYPE TEXT USING "category"::text;

DROP TYPE "UnitCategory";
