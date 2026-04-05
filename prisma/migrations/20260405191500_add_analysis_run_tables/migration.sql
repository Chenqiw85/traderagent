-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "ragMode" TEXT,
    "status" TEXT NOT NULL,
    "finalAction" TEXT,
    "finalConfidence" DOUBLE PRECISION,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisStage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalysisRun_ticker_market_asOf_idx" ON "AnalysisRun"("ticker", "market", "asOf");

-- CreateIndex
CREATE INDEX "AnalysisRun_createdAt_idx" ON "AnalysisRun"("createdAt");

-- CreateIndex
CREATE INDEX "AnalysisStage_runId_stage_idx" ON "AnalysisStage"("runId", "stage");

-- AddForeignKey
ALTER TABLE "AnalysisStage" ADD CONSTRAINT "AnalysisStage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
