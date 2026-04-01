# Command List

All commands for the traderagent project. Run from the project root.

> **Important:** When passing arguments through `npm run`, use `--` to separate npm flags from script arguments.

## Analysis

```bash
# Analyze a stock (default market: US)
npm run run:analyze -- AAPL
npm run run:analyze -- AAPL US

# Analyze a stock on other markets
npm run run:analyze -- 0700 HK
npm run run:analyze -- 600519 CN
```

| Argument | Required | Description |
|----------|----------|-------------|
| `TICKER` | Yes | Stock symbol (e.g. AAPL, SNDK, 0700) |
| `MARKET` | No | Market: `US` (default), `CN`, `HK` |

## Watchlist

```bash
# Add a ticker to the watchlist
npm run watchlist:add -- AAPL
npm run watchlist:add -- AAPL US
npm run watchlist:add -- 0700 HK

# Remove a ticker from the watchlist
npm run watchlist:remove -- AAPL

# List all active watchlist entries
npm run watchlist:list
```

## Data Sync

```bash
# Sync all watchlist tickers from external APIs into Postgres
npm run db:sync

# Sync a single ticker
npm run db:sync -- --ticker AAPL
npm run db:sync -- --ticker AAPL US
```

Data sources tried in order: Finnhub (if `FINNHUB_API_KEY` set) then Yahoo Finance.

## Scheduler

```bash
# Start the cron scheduler (default: weekdays at 16:30 — US market close)
npm run scheduler:start

# Start with a custom cron expression
npm run scheduler:start -- "0 9 * * 1-5"
```

Press `Ctrl+C` to stop the scheduler.

## Database

```bash
# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate
```

Requires `DATABASE_URL` in `.env`.

## Development

```bash
# Build the project (TypeScript compilation)
npm run build

# Type-check without emitting files
npm run typecheck

# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | For DB features | PostgreSQL connection string |
| `FINNHUB_API_KEY` | No | Finnhub API key (adds Finnhub to data sources) |
| `OPENAI_API_KEY` | For Qdrant RAG | OpenAI API key for embeddings |
| `QDRANT_URL` | For Qdrant RAG | Qdrant vector database URL |
| `OLLAMA_HOST` | For local RAG | Ollama host for local embeddings |

### RAG Modes (auto-detected)

- **Full:** `OPENAI_API_KEY` + `QDRANT_URL` set -> Qdrant + OpenAI embeddings
- **In-memory:** `OLLAMA_HOST` set -> local store + Ollama embeddings
- **Disabled:** neither set
