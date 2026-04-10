CREATE TABLE "AdvisorForecast" (
  "id" TEXT NOT NULL,
  "ticker" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "targetSession" TIMESTAMP(3) NOT NULL,
  "predictedDirection" TEXT NOT NULL,
  "referencePrice" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "baselineAction" TEXT NOT NULL,
  "baselineAsOf" TIMESTAMP(3) NOT NULL,
  "changeFromBaseline" TEXT NOT NULL,
  "actualClose" DOUBLE PRECISION,
  "actualDirection" TEXT,
  "scoredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdvisorForecast_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdvisorForecast_ticker_market_issuedAt_idx"
  ON "AdvisorForecast"("ticker", "market", "issuedAt");

CREATE INDEX "AdvisorForecast_targetSession_market_idx"
  ON "AdvisorForecast"("targetSession", "market");
