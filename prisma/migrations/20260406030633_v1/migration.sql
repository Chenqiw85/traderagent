-- DropIndex
DROP INDEX "Lesson_ticker_market_idx";

-- CreateIndex
CREATE INDEX "Lesson_ticker_idx" ON "Lesson"("ticker");
