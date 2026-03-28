# Stable Data Fetching with Local Postgres Storage

**Date:** 2026-03-27
**Status:** Approved

## Problem

Data fetching from external APIs (Yahoo Finance, Finnhub, etc.) is unreliable — rate limiting (429s), access restrictions (403s), and transient network failures cause the analysis pipeline to fail. The current architecture couples fetching and analysis, so a flaky API blocks the entire workflow.

## Solution

Decouple data fetching from analysis into two phases:

1. **Fetch & Store** — a scheduled process pulls data from external APIs and writes it to a local Postgres database. Runs daily after market close.
2. **Analyze** — the existing agent pipeline reads from Postgres first, falling back to live APIs only if data is missing.

## Technology Choices

- **Database:** PostgreSQL 16 (via Docker Compose)
- **ORM:** Prisma (type-safe queries, auto-generated migrations)
- **Scheduler:** `node-cron` for daily fetch triggers
- **Approach:** DB-first with API fallback for ad-hoc tickers

## Database Schema

### `watchlist`

Tickers to fetch on schedule.

| Column    | Type      | Notes              |
|-----------|-----------|--------------------|
| id        | Int       | Auto-increment PK  |
| ticker    | String    | Unique             |
| market    | String    | US / CN / HK       |
| active    | Boolean   | Default true        |
| createdAt | DateTime  | Auto               |
| updatedAt | DateTime  | Auto               |

### `ohlcv`

Daily price bars.

| Column   | Type     | Notes                          |
|----------|----------|--------------------------------|
| id       | Int      | Auto-increment PK              |
| ticker   | String   |                                |
| market   | String   | US / CN / HK                   |
| date     | DateTime | Unique constraint with ticker  |
| open     | Float    |                                |
| high     | Float    |                                |
| low      | Float    |                                |
| close    | Float    |                                |
| volume   | BigInt   |                                |
| source   | String   | Which API provided the data    |
| fetchedAt| DateTime |                                |

**Index:** `(ticker, date)` unique

### `fundamentals`

Company financial data.

| Column   | Type     | Notes                       |
|----------|----------|-----------------------------|
| id       | Int      | Auto-increment PK           |
| ticker   | String   |                             |
| market   | String   | US / CN / HK                |
| data     | Json     | Flexible structure per source|
| source   | String   |                             |
| fetchedAt| DateTime |                             |

**Index:** `(ticker)`

### `news`

Articles and headlines.

| Column      | Type     | Notes              |
|-------------|----------|--------------------|
| id          | Int      | Auto-increment PK  |
| ticker      | String   |                    |
| market      | String   | US / CN / HK       |
| title       | String   |                    |
| url         | String   | Unique             |
| source      | String   |                    |
| publishedAt | DateTime |                    |
| data        | Json     | Extra fields       |
| fetchedAt   | DateTime |                    |

**Index:** `(ticker)`, unique on `url`

### `technicals`

Computed indicator values.

| Column     | Type     | Notes                         |
|------------|----------|-------------------------------|
| id         | Int      | Auto-increment PK             |
| ticker     | String   |                               |
| market     | String   | US / CN / HK                  |
| date       | DateTime | Unique constraint with ticker |
| indicators | Json     | SMA, RSI, MACD, etc.         |
| computedAt | DateTime |                               |

**Index:** `(ticker, date)` unique

### `fetch_log`

Observability for each fetch run.

| Column   | Type     | Notes                       |
|----------|----------|-----------------------------|
| id       | Int      | Auto-increment PK           |
| ticker   | String   |                             |
| market   | String   | US / CN / HK                |
| dataType | String   | ohlcv / news / fundamentals / technicals |
| source   | String   |                             |
| status   | String   | success / failed            |
| error    | String   | Nullable                    |
| duration | Int      | Milliseconds                |
| fetchedAt| DateTime |                             |

## Architecture

### New Components

1. **`PostgresDataSource`** — implements `IDataSource`, reads from Postgres. Checks data freshness before returning; throws if stale so `FallbackDataSource` moves to the next API source. Data fetched via API fallback is written back to Postgres for future use.

2. **`DataSyncService`** — the scheduled fetcher. Iterates the watchlist, calls existing API sources (YFinance, Finnhub, etc.), writes results to Postgres. Retries transient failures (3 attempts, exponential backoff: 1s, 4s, 16s). Logs every attempt to `fetch_log`.

3. **`Scheduler`** — `node-cron` process that triggers `DataSyncService` daily after market close. Configurable per market (e.g. 4:30 PM ET for US, 3:30 PM CST for CN).

### Data Flow

```
Scheduled Fetch (Phase 1):
  Scheduler (node-cron)
    -> DataSyncService
      -> Existing API sources (YFinance, Finnhub, etc.)
      -> Write to Postgres (ohlcv, fundamentals, news)
      -> Compute technicals -> Write to technicals table
      -> Log results to fetch_log

Analysis (Phase 2):
  run.ts / CLI
    -> DataFetcher agent
      -> FallbackDataSource
        -> PostgresDataSource (try DB first)
        -> YFinanceSource (API fallback if not in DB)
      -> TechnicalAnalyzer -> Researchers -> Risk -> Manager
```

### Fallback Chain Integration

`PostgresDataSource` is inserted at position 0 in the existing `FallbackDataSource`:

```
FallbackDataSource('price-chain', [
  PostgresDataSource,    // NEW: try DB first
  FinnhubSource,         // existing API fallback
  YFinanceSource,        // existing API fallback
])
```

**Freshness check:** For OHLCV, data is "fresh" if the latest row is from the most recent trading day. For fundamentals, fresh if fetched within the last 24 hours. For news, fresh if fetched within the last 24 hours. If stale or missing, throws to trigger API fallback. API fallback results are written back to Postgres.

## CLI Commands

- `npm run db:sync` — manual one-off fetch for all watchlist tickers
- `npm run db:sync -- --ticker AAPL` — fetch a single ticker
- `npm run scheduler:start` — start the cron scheduler
- `npm run watchlist:add -- AAPL US` — add ticker to watchlist
- `npm run watchlist:remove -- AAPL` — remove ticker
- `npm run watchlist:list` — show current watchlist

## File Structure

```
traderagent/
├── docker-compose.yml
├── prisma/
│   └── schema.prisma
├── src/
│   ├── db/
│   │   ├── client.ts               # Prisma client singleton
│   │   └── PostgresDataSource.ts   # IDataSource reading from DB
│   ├── sync/
│   │   ├── DataSyncService.ts      # APIs -> DB writer with retry
│   │   ├── Scheduler.ts            # node-cron daily trigger
│   │   └── watchlist.ts            # Add/remove/list helpers
│   └── cli/
│       ├── sync.ts                 # npm run db:sync entry point
│       ├── scheduler.ts            # npm run scheduler:start entry point
│       └── watchlist.ts            # Watchlist commands entry point
├── tests/
│   ├── db/
│   │   └── PostgresDataSource.test.ts
│   └── sync/
│       ├── DataSyncService.test.ts
│       └── Scheduler.test.ts
```

## Changes to Existing Code

- **`run.ts`** — construct `PostgresDataSource` and prepend to fallback chain
- **`DataFetcher`** — no changes (already works with `IDataSource[]`)
- **`TechnicalAnalyzer`** — no changes (reads from `TradingReport.rawData`)
- **`.env.example`** — add `DATABASE_URL`
- **`package.json`** — add `prisma`, `@prisma/client`, `node-cron`, `@types/node-cron`

## Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: traderagent
      POSTGRES_USER: trader
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

## Testing Strategy

- **PostgresDataSource** — real Postgres via Docker. Verify returns data when fresh, throws when stale, handles missing tickers.
- **DataSyncService** — mock API sources, verify correct DB writes and `fetch_log` entries. Test retry logic with simulated failures.
- **Scheduler** — test cron expression parsing and `DataSyncService.syncAll()` invocation.
- **Integration** — seed watchlist, run sync, run analysis, verify pipeline reads from DB.

## Dependencies

- `prisma` + `@prisma/client` — ORM and type-safe queries
- `node-cron` — scheduler
- `@types/node-cron` — TypeScript types

## Retry Logic (DataSyncService)

- 3 attempts per source per data type
- Exponential backoff: 1s, 4s, 16s
- On all retries failing: log error to `fetch_log`, continue to next ticker
- Never blocks the full batch on a single ticker failure
