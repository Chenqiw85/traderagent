-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "passNumber" INTEGER NOT NULL,
    "windowType" TEXT NOT NULL,
    "totalDays" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "compositeScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestDecision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit" DOUBLE PRECISION,
    "actualReturn" DOUBLE PRECISION NOT NULL,
    "hitTakeProfit" BOOLEAN NOT NULL,
    "hitStopLoss" BOOLEAN NOT NULL,
    "compositeScore" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,

    CONSTRAINT "BacktestDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "passNumber" INTEGER NOT NULL,
    "condition" TEXT NOT NULL,
    "lesson" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BacktestRun_ticker_idx" ON "BacktestRun"("ticker");

-- CreateIndex
CREATE INDEX "BacktestDecision_runId_idx" ON "BacktestDecision"("runId");

-- CreateIndex
CREATE INDEX "Lesson_ticker_idx" ON "Lesson"("ticker");

-- CreateIndex
CREATE INDEX "Lesson_passNumber_idx" ON "Lesson"("passNumber");

-- AddForeignKey
ALTER TABLE "BacktestDecision" ADD CONSTRAINT "BacktestDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BacktestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
