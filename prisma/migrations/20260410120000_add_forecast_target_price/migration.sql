ALTER TABLE "AdvisorForecast" ADD COLUMN "targetPrice" DOUBLE PRECISION;

UPDATE "AdvisorForecast" SET "targetPrice" = "referencePrice" WHERE "targetPrice" IS NULL;

ALTER TABLE "AdvisorForecast" ALTER COLUMN "targetPrice" SET NOT NULL;
