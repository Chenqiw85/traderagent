-- CreateTable
CREATE TABLE "Watchlist" (
    "id" SERIAL NOT NULL,
    "ticker" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ohlcv" (
    "id" SERIAL NOT NULL,
    "ticker" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ohlcv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fundamentals" (
    "id" SERIAL NOT NULL,
    "ticker" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fundamentals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "News" (
    "id" SERIAL NOT NULL,
    "ticker" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "data" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "News_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Technicals" (
    "id" SERIAL NOT NULL,
    "ticker" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "indicators" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Technicals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FetchLog" (
    "id" SERIAL NOT NULL,
    "ticker" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "duration" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FetchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_ticker_key" ON "Watchlist"("ticker");

-- CreateIndex
CREATE INDEX "Ohlcv_ticker_idx" ON "Ohlcv"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "Ohlcv_ticker_date_key" ON "Ohlcv"("ticker", "date");

-- CreateIndex
CREATE INDEX "Fundamentals_ticker_idx" ON "Fundamentals"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "News_url_key" ON "News"("url");

-- CreateIndex
CREATE INDEX "News_ticker_idx" ON "News"("ticker");

-- CreateIndex
CREATE INDEX "Technicals_ticker_idx" ON "Technicals"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "Technicals_ticker_date_key" ON "Technicals"("ticker", "date");

-- CreateIndex
CREATE INDEX "FetchLog_ticker_idx" ON "FetchLog"("ticker");

-- CreateIndex
CREATE INDEX "FetchLog_fetchedAt_idx" ON "FetchLog"("fetchedAt");
