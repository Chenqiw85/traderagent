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

The analysis pipeline produces a 5-tier recommendation: **BUY**, **OVERWEIGHT**, **HOLD**, **UNDERWEIGHT**, or **SELL** with confidence score, stop loss, and take profit levels.

The live pipeline now surfaces explicit decision stages:
- `Research Thesis`
- `Trader Proposal`
- `Risk Verdict`
- final 5-tier decision

A markdown report is automatically saved to `reports/AAPL_US_<timestamp>.md`.
If `DATABASE_URL` is set, the run is also persisted to Postgres as an `AnalysisRun` plus per-stage `AnalysisStage` artifacts.

## Trader Training

```bash
# Train with default settings
npm run trader:train -- AAPL US

# Train with custom parameters
npm run trader:train -- AAPL US --passes 4 --lookback 12
```

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `TICKER` | Yes | — | Stock symbol to train on |
| `MARKET` | No | `US` | Market: `US`, `CN`, `HK` |
| `--passes` | No | 3 | Maximum training passes (early stopping applies) |
| `--lookback` | No | 6 | Months of historical data to use |

Training uses the Backtester with look-ahead bias prevention (DateFilteredDataSource), scores decisions with the CompositeScorer, extracts lessons via LLM, and runs structured reflections on the worst-performing decisions.

A markdown report is automatically saved to `reports/training_AAPL_US_<timestamp>.md`.

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

## Advisor

```bash
# Run advisor once for all watchlist tickers
npm run advisor

# Run advisor once for specific tickers
npm run advisor -- AAPL,TSLA US

# Run advisor in dry-run mode (skip WhatsApp connect/send)
npm run advisor -- --dry-run

# Start the advisor scheduler
npm run advisor:schedule
```

The advisor analyzes market indices (SPY, QQQ, DIA, VIX, FXI, KWEB, MCHI), runs the full pipeline on each watchlist ticker, and synthesizes a market briefing. WhatsApp delivery is configured via environment variables, not a `--whatsapp` flag.

A markdown report is automatically saved to `reports/advisor_<timestamp>.md`.

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

## Reports

All commands automatically generate markdown reports in the `reports/` directory:

```
reports/
├── AAPL_US_2026-04-05_1030.md           # Single stock analysis
├── training_AAPL_US_2026-04-05_1030.md  # Training results
└── advisor_2026-04-05_1630.md           # Daily advisor briefing
```

Reports include:
- **Analysis:** 5-tier decision, research thesis, trader proposal, risk verdict, technical indicators, research findings, risk assessment
- **Training:** Per-pass scores, win rates, action breakdowns, lesson counts, improvement tracking
- **Advisor:** Market index overview, ticker recommendations table, detailed reasoning, summary

The `reports/` directory is git-ignored and created automatically on first run.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SILICONFLOW_API_KEY` | For analysis | SiliconFlow API key for research, trade planner, risk, and manager agents |
| `DATABASE_URL` | For DB features | PostgreSQL connection string for cache tables plus `AnalysisRun` / `AnalysisStage` persistence |
| `FINNHUB_API_KEY` | No | Finnhub API key (adds Finnhub to data sources) |
| `OPENAI_API_KEY` | For Qdrant RAG | OpenAI API key for embeddings |
| `QDRANT_URL` | For Qdrant RAG | Qdrant vector database URL |
| `OLLAMA_HOST` | For local RAG | Enables local BM25-backed RAG mode detection (default host: `http://localhost:11434`) |
| `RAG_BM25` | No | Set to `true` for BM25 keyword-based RAG (no API keys needed) |
| `ANTHROPIC_API_KEY` | No | Anthropic Claude API key (alternative LLM) |
| `GEMINI_API_KEY` | No | Google Gemini API key (alternative LLM) |
| `OUTPUT_LANGUAGE` | No | Output language: `en` (default), `zh`, `zh-TW`, `ja`, `ko` |
| `ADVISOR_WHATSAPP_TO` | No | Destination number for advisor WhatsApp delivery |

### RAG Modes (auto-detected)

- **Full:** `OPENAI_API_KEY` + `QDRANT_URL` set -> Qdrant + OpenAI embeddings
- **In-memory:** `OLLAMA_HOST` set -> local BM25 keyword-search store
- **BM25:** `RAG_BM25=true` -> keyword-based text search (no API keys, fully offline)
- **Disabled:** none of the above set

### Pipeline Configuration

These features are configured programmatically via `PipelineConfig` in `src/config/config.ts`:

| Option | Default | Description |
|--------|---------|-------------|
| `enabledAnalysts` | `['bull', 'bear', 'news', 'fundamentals']` | Select which analysts run |
| `debateEnabled` | `false` | Enable Bull vs Bear adversarial debate |
| `maxDebateRounds` | `2` | Number of debate rounds |
| `riskDebateEnabled` | `false` | Enable Aggressive/Conservative/Neutral risk debate with proposal-aware `PortfolioManager` synthesis |
| `outputLanguage` | `'en'` | Output language for all LLM responses |
| `ragMode` | auto-detected | Override RAG mode |
