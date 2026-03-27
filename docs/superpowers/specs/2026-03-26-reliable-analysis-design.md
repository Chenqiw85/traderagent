# Reliable Analysis Pipeline — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Goal:** Make the trading agent produce evidence-grounded analysis by fixing data reliability, adding real computed indicators, activating RAG, and enforcing hard failures on missing data.

---

## Problem Statement

The current pipeline has three critical failures:

1. **Data sources don't work reliably** — `yahoo-finance2` v2.14 gets 429 blocked by Yahoo; Finnhub free tier returns 403 on `/stock/candle` (OHLCV/technicals).
2. **LLM agents hallucinate** — when data fetching fails, researchers receive no data but still produce confident-sounding analysis with fabricated numbers.
3. **No real computation** — risk metrics (VaR, volatility, beta) and technical indicators are "calculated" by the LLM in its head, not from actual math on real price series.

## Design Decisions

- **Approach A (Layered Computation Pipeline)** — a new `TechnicalAnalyzer` stage between DataFetcher and Researchers computes all indicators from raw data. Researchers interpret computed facts, not raw JSON.
- **Fallback data sources** — Finnhub first, Yahoo Finance fallback. Pipeline aborts if critical data types fail from all sources.
- **Configurable RAG** — Qdrant + OpenAI embeddings when available, in-memory + Ollama fallback, or skip entirely.
- **Hard fail on missing data** — critical data types abort the pipeline; agents independently verify their required data before calling the LLM.

---

## Section 1: Data Source Fallback Chain

### FallbackDataSource

A new wrapper class implementing `IDataSource` that tries multiple sources in order:

```typescript
new FallbackDataSource('price-chain', [new FinnhubSource(), new YFinanceSource()])
```

- Tries the first source. If it throws (403, timeout, network error), tries the next.
- Logs which source succeeded: `[DataFetcher] ohlcv: finnhub failed (403), yfinance succeeded`
- Implements `IDataSource` — transparent to the rest of the pipeline.

### Data Criticality

```typescript
const DATA_CRITICALITY: Record<DataType, 'critical' | 'optional'> = {
  ohlcv: 'critical',
  fundamentals: 'critical',
  technicals: 'critical',
  news: 'optional',
}
```

**Enforcement in DataFetcher:**
- After all fetch attempts complete, check if any critical data type has zero successful results.
- If a critical type failed from all sources, throw an error and abort the pipeline:
  `"ABORT: Failed to fetch critical data type 'ohlcv' for AAPL from all sources (finnhub: 403 Forbidden, yfinance: 429 Too Many Requests)"`
- Optional types log a warning but the pipeline continues.

### Yahoo Finance Fix

Restore `yfinance.ts` to use the correct `yahoo-finance2` API. If v2.14 remains broken, downgrade to a working version (e.g. v2.11.3) that supports `historical()`, `quoteSummary()`, and `search()`.

---

## Section 2: Technical Analyzer — Computation Layer

### Pipeline Position

```
DataFetcher → TechnicalAnalyzer → Researchers → Risk → Manager
```

### Purpose

Pure computation stage — no LLM calls. Takes raw OHLCV price arrays from `report.rawData` and produces structured `ComputedIndicators` on the report.

### ComputedIndicators Type

```typescript
type ComputedIndicators = {
  trend: {
    sma50: number
    sma200: number
    ema12: number
    ema26: number
    macd: { line: number; signal: number; histogram: number }
  }
  momentum: {
    rsi: number
    stochastic: { k: number; d: number }
  }
  volatility: {
    bollingerUpper: number
    bollingerMiddle: number
    bollingerLower: number
    atr: number
    historicalVolatility: number
  }
  volume: {
    obv: number
  }
  risk: {
    beta: number
    maxDrawdown: number
    var95: number
  }
  fundamentals: {
    pe: number | null
    pb: number | null
    dividendYield: number | null
    eps: number | null
  }
}
```

### Indicator Module Structure

All indicator math lives in `src/indicators/` as pure functions:

| File | Functions | Input |
|------|-----------|-------|
| `trend.ts` | `calcSMA(prices, period)`, `calcEMA(prices, period)`, `calcMACD(prices)` | Close prices array |
| `momentum.ts` | `calcRSI(prices, period)`, `calcStochastic(highs, lows, closes, period)` | OHLC arrays |
| `volatility.ts` | `calcBollinger(prices, period, stddev)`, `calcATR(highs, lows, closes, period)`, `calcHistoricalVolatility(prices)` | OHLC arrays |
| `volume.ts` | `calcOBV(closes, volumes)` | Close + volume arrays |
| `risk.ts` | `calcBeta(stockReturns, marketReturns)`, `calcMaxDrawdown(prices)`, `calcVaR(returns, confidence)` | Returns arrays |
| `index.ts` | Re-exports all functions | — |

Each function is individually unit-testable with known inputs/outputs.

### TechnicalAnalyzer Agent

- Implements `IAgent` so it slots into the orchestrator.
- Constructor receives `dataSource: IDataSource` (the same fallback chain used by DataFetcher) — needed to fetch SPY data for beta calculation.
- Extracts OHLCV arrays from `report.rawData`.
- Calls each indicator function.
- For beta: fetches SPY OHLCV via its `dataSource`, computes stock returns vs market returns.
- Writes `report.computedIndicators`.
- Throws if OHLCV data is missing (but DataFetcher's criticality check should prevent this).

### Test Files

Each indicator module gets a corresponding test file:

```
tests/indicators/trend.test.ts
tests/indicators/momentum.test.ts
tests/indicators/volatility.test.ts
tests/indicators/volume.test.ts
tests/indicators/risk.test.ts
tests/agents/technicalAnalyzer.test.ts
```

Tests use known inputs with hand-calculated expected outputs.

---

## Section 3: RAG Integration — Configurable Storage

### Two Modes

| Mode | Vector Store | Embedder | Persists? | When |
|------|-------------|----------|-----------|------|
| Full RAG | `QdrantVectorStore` | OpenAI `text-embedding-ada-002` | Yes | `OPENAI_API_KEY` + `QDRANT_URL` in `.env` |
| In-Memory | `InMemoryVectorStore` (new) | `OllamaEmbedder` (new) | No | `OLLAMA_HOST` in `.env` |
| Disabled | null | null | — | Neither configured (current default) |

Auto-detection logic in `run.ts`:
1. If `OPENAI_API_KEY` and `QDRANT_URL` are set → full RAG
2. Else if `OLLAMA_HOST` is set → in-memory mode
3. Else → skip RAG, log warning

### What Gets Stored

- Raw fetched data (OHLCV, fundamentals, news)
- Computed indicators from TechnicalAnalyzer
- Past analysis findings (persistent Qdrant: previous runs' findings become context for future runs)

Each document is tagged with metadata: `{ ticker, market, dataType, date, source }` for filtered retrieval.

### New Files

- `src/rag/InMemoryVectorStore.ts` — implements `IVectorStore`, stores documents in a Map, uses cosine similarity for search.
- `src/rag/OllamaEmbedder.ts` — implements `Embedder` interface, calls Ollama's embedding endpoint.

### Agent Usage

`BaseResearcher.retrieveContext()` already queries the vector store — no changes needed to the retrieval logic. The difference is that data is now actually being stored, so agents will get real historical context.

---

## Section 4: Hard Fail on Missing Data

### Two Layers of Defense

**Layer 1 — DataFetcher (Section 1):**
Pipeline aborts if critical data types fail from all sources.

**Layer 2 — Agent-level guards:**

Each agent declares what data it requires:

```typescript
// BaseResearcher — new abstract property
abstract readonly requiredData: DataType[]
```

Before any LLM call, the agent checks:

```typescript
const missing = this.requiredData.filter(
  type => !report.rawData.some(d => d.type === type)
    && !(type === 'technicals' && report.computedIndicators)
)
if (missing.length > 0) {
  throw new Error(`${this.name}: cannot analyze — missing required data: ${missing.join(', ')}`)
}
```

### Per-Agent Requirements

| Agent | Required Data | Rationale |
|-------|-------------|-----------|
| BullResearcher | `ohlcv`, `fundamentals` | Needs price + fundamentals to find buy signals |
| BearResearcher | `ohlcv`, `fundamentals` | Needs price + fundamentals to find sell signals |
| FundamentalsAnalyst | `fundamentals` | Core dependency |
| NewsAnalyst | none (all optional) | Works from RAG context or analyst ratings; notes gap if no news |
| RiskAnalyst | `ohlcv` + `computedIndicators` | Uses real computed metrics |
| RiskManager | depends on RiskAnalyst output | Already guards on `!report.riskAssessment` |
| Manager | at least 1 `researchFinding` | Refuses to decide with zero findings |

---

## Section 5: Restructured Agent Prompts

### Prompt Template Structure

All researcher prompts follow this format:

```
[Role description]

=== COMPUTED INDICATORS (calculated from real market data) ===
Trend:       SMA50=$191.3  SMA200=$185.7  MACD=1.42 (signal=0.98, hist=+0.44)
Momentum:    RSI=62.3  Stochastic %K=71.2 %D=68.5
Volatility:  Bollinger [189.1 / 193.4 / 197.7]  ATR=$3.21  HistVol=22.1%
Volume:      OBV=+1.2B (rising)
Risk:        Beta=1.12  MaxDrawdown=-8.3%  VaR95=-2.1%
Fundamentals: P/E=31.2  P/B=48.1  DivYield=0.52%  EPS=$6.42

=== RAG CONTEXT (historical patterns) ===
[retrieved from vector store — may be empty on first run]

=== RAW DATA (for reference) ===
[current price, 52-week range, moving averages from fetched data]

RULES:
- ALL evidence MUST cite specific numbers from above
- If a data point is not shown above, say "data not available" — do NOT estimate
- Confidence must reflect data quality: strong data = high confidence, gaps = lower
```

### RiskAnalyst Change

Currently asks the LLM to "calculate" VaR, volatility, beta. After this change, `RiskAnalyst` reads `report.computedIndicators.risk` directly and uses the LLM only to interpret the pre-computed metrics and determine risk level.

---

## Section 6: File Changes

### New Files

```
src/data/FallbackDataSource.ts           — IDataSource wrapper, tries sources in order
src/rag/InMemoryVectorStore.ts           — IVectorStore impl, in-memory with cosine similarity
src/rag/OllamaEmbedder.ts               — local embeddings via Ollama
src/indicators/index.ts                  — re-exports all indicator functions
src/indicators/trend.ts                  — SMA, EMA, MACD
src/indicators/momentum.ts              — RSI, Stochastic
src/indicators/volatility.ts            — Bollinger, ATR, historical volatility
src/indicators/volume.ts                — OBV
src/indicators/risk.ts                  — beta, max drawdown, VaR
src/agents/analyzer/TechnicalAnalyzer.ts — computation stage agent
```

### Modified Files

```
src/agents/base/types.ts                — add ComputedIndicators, DATA_CRITICALITY
src/agents/data/DataFetcher.ts          — criticality enforcement, abort on critical failure
src/agents/researcher/BaseResearcher.ts — requiredData guard, structured prompt format
src/agents/researcher/BullResearcher.ts — new prompt template, requiredData
src/agents/researcher/BearResearcher.ts — new prompt template, requiredData
src/agents/researcher/FundamentalsAnalyst.ts — new prompt template, requiredData
src/agents/researcher/NewsAnalyst.ts    — new prompt template, requiredData = []
src/agents/risk/RiskAnalyst.ts          — use computedIndicators, not LLM guesswork
src/agents/risk/RiskManager.ts          — use computedIndicators
src/agents/manager/Manager.ts           — refuse to decide with zero findings
src/orchestrator/Orchestrator.ts        — add TechnicalAnalyzer stage
src/config/config.ts                    — RAG mode auto-detection
src/run.ts                              — wire up fallback chain + RAG config
src/data/yfinance.ts                    — restore full yahoo-finance2 API
.env.example                            — add QDRANT_URL, OPENAI_API_KEY, OLLAMA_HOST
```

### Unchanged

- `IAgent`, `IDataSource`, `IVectorStore`, `ILLMProvider` interfaces
- LLM registry and all 5 provider adapters
- Qdrant, Embedder, Chunker implementations
- Evaluation layer (ReasoningEvaluator, AccuracyEvaluator, BacktestEvaluator)
