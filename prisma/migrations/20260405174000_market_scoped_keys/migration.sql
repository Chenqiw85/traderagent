-- Drop old single-market uniqueness and indexes
DROP INDEX "Watchlist_ticker_key";
DROP INDEX "Ohlcv_ticker_idx";
DROP INDEX "Ohlcv_ticker_date_key";
DROP INDEX "Fundamentals_ticker_idx";
DROP INDEX "News_ticker_idx";
DROP INDEX "Technicals_ticker_idx";
DROP INDEX "Technicals_ticker_date_key";
DROP INDEX "FetchLog_ticker_idx";
DROP INDEX "BacktestRun_ticker_idx";
DROP INDEX "Lesson_ticker_idx";

-- Recreate market-aware uniqueness and indexes
CREATE UNIQUE INDEX "Watchlist_ticker_market_key" ON "Watchlist"("ticker", "market");

CREATE INDEX "Ohlcv_ticker_market_idx" ON "Ohlcv"("ticker", "market");
CREATE UNIQUE INDEX "Ohlcv_ticker_market_date_key" ON "Ohlcv"("ticker", "market", "date");

CREATE INDEX "Fundamentals_ticker_market_idx" ON "Fundamentals"("ticker", "market");

CREATE INDEX "News_ticker_market_idx" ON "News"("ticker", "market");

CREATE INDEX "Technicals_ticker_market_idx" ON "Technicals"("ticker", "market");
CREATE UNIQUE INDEX "Technicals_ticker_market_date_key" ON "Technicals"("ticker", "market", "date");

CREATE INDEX "FetchLog_ticker_market_idx" ON "FetchLog"("ticker", "market");
CREATE INDEX "BacktestRun_ticker_market_idx" ON "BacktestRun"("ticker", "market");
CREATE INDEX "Lesson_ticker_market_idx" ON "Lesson"("ticker", "market");
