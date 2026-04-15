-- AlterTable
ALTER TABLE "AdvisorForecast" ADD COLUMN     "atrRangeHigh" DOUBLE PRECISION,
ADD COLUMN     "atrRangeLow" DOUBLE PRECISION,
ADD COLUMN     "scoringStatus" TEXT;

-- CreateIndex
CREATE INDEX "AdvisorForecast_scoringStatus_targetSession_idx" ON "AdvisorForecast"("scoringStatus", "targetSession");
