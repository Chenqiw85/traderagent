# TradingAgent — Developer Guide

This document explains what was built, how the pieces fit together, and how to extend the system.

---

## What was built (Plan 1 — Foundation)

Starting from an empty repo, we designed and implemented the foundation of a multi-agent trading platform. Here is exactly what was done, in order:

### 1. Brainstorming & Design

Before writing any code, we ran a full design session to make decisions:

| Decision | Choice | Why |
|----------|--------|-----|
| Language | TypeScript | Type safety for complex agent interfaces |
| LLM providers | OpenAI, Anthropic, Gemini, Ollama, DeepSeek | Cover all major providers including Chinese models |
| Data sources | Market data, News, Fundamentals, Technicals | Full picture for researchers |
| Vector store | Qdrant (behind interface) | Fast, open-source, great TS SDK |
| Agent communication | Shared state / blackboard | Simple, debuggable, faithful to TradingAgents paper |
| Agent execution | Parallel teams + Manager aggregation | Teams run in parallel; manager reads full report |
| Markets | US equities + Chinese A-shares/HK | Dual-market coverage |

The full design is at [`docs/superpowers/specs/2026-03-25-traderagent-design.md`](superpowers/specs/2026-03-25-traderagent-design.md).

### 2. Core Domain Types (`src/agents/base/types.ts`)

All shared types that flow through the entire system live here. Nothing else defines domain types — every agent, evaluator, and orchestrator imports from this one file.

```
AgentRole      — 'researcher' | 'risk' | 'manager' | 'data'
Market         — 'US' | 'CN' | 'HK'
DataType       — 'ohlcv' | 'news' | 'fundamentals' | 'technicals'
DataQuery      — what to fetch: ticker + market + type + date range
DataResult     — what came back from a data source
Finding        — what a researcher agent concludes: stance, evidence, confidence
RiskAssessment — what the risk team calculates: VaR, volatility, position sizing
Decision       — the manager's final output: BUY|SELL|HOLD + confidence + reasoning
TradingReport  — the shared blackboard: everything from raw data to final decision
```

### 3. LLM Layer (`src/llm/`)

Every LLM provider implements one interface:

```ts
interface ILLMProvider {
  readonly name: string
  chat(messages: Message[], options?: LLMOptions): Promise<string>
  chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string>
}
```

Five adapters were built:

| File | Provider | Notes |
|------|----------|-------|
| `openai.ts` | OpenAI | Supports `baseURL` override — used by DeepSeek |
| `anthropic.ts` | Anthropic | Extracts system messages separately (Anthropic API requirement) |
| `gemini.ts` | Google Gemini | Concatenates messages into a flat prompt string |
| `ollama.ts` | Ollama (local) | Calls local Ollama server; `chatStream` yields full response |
| `deepseek.ts` | DeepSeek | Extends `OpenAIProvider` with DeepSeek's base URL |

### 4. LLM Registry (`src/llm/registry.ts`)

The registry resolves a provider instance by agent name, reading API keys from environment variables. It caches instances so each agent gets the same provider object on repeated calls.

```ts
const registry = new LLMRegistry(agentConfig)
const llm = registry.get('manager')   // returns OpenAIProvider configured for o3-mini
await llm.chat([{ role: 'user', content: 'Should I buy AAPL?' }])
```

### 5. Config (`src/config/config.ts`)

A single file maps each agent name to its LLM provider and model. Change a model or swap a provider here — nothing else needs to change.

---

## How the interfaces work

The key design principle: **every external dependency is behind an interface**.

```
ILLMProvider  → swap OpenAI for Gemini for any agent, just change config
IDataSource   → swap yfinance for Polygon, or add a new source
IVectorStore  → swap Qdrant for Pinecone without touching any agent code
IAgent        → every agent has the same contract: takes TradingReport, returns TradingReport
IEvaluator    → every evaluator scores a TradingReport the same way
```

This means you can test any layer in isolation by passing a fake implementation of its dependencies.

---

## How to add a new LLM provider

1. Create `src/llm/myprovider.ts`:

```ts
import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'

export class MyProvider implements ILLMProvider {
  readonly name: string = 'myprovider'

  constructor(private config: { apiKey: string; model: string }) {}

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    // call your provider's API here
    return 'response text'
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    // yield chunks
    yield 'response text'
  }
}
```

2. Add it to `src/llm/registry.ts` in the `createProvider` switch:

```ts
case 'myprovider':
  return new MyProvider({ apiKey: apiKey('MYPROVIDER_API_KEY'), model })
```

3. Add it to the `LLMProviderName` union in `src/config/config.ts`:

```ts
export type LLMProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'deepseek' | 'myprovider'
```

4. Write a test in `tests/llm/myprovider.test.ts` mocking your SDK.

5. Assign it to an agent in `agentConfig`.

---

## How the TradingReport flows

The `TradingReport` is the blackboard — every agent reads from it and writes to it:

```
{}  ← empty report created for ticker "AAPL"

DataFetcher runs:
  report.rawData = [ohlcv data, news articles, filings, technicals]

Researcher Team runs in parallel:
  BullResearcher   → report.researchFindings.push({ stance: 'bull', evidence: [...], confidence: 0.8 })
  BearResearcher   → report.researchFindings.push({ stance: 'bear', evidence: [...], confidence: 0.6 })
  NewsAnalyst      → report.researchFindings.push({ stance: 'bull', sentiment: 'positive', ... })
  FundamentalsAnalyst → report.researchFindings.push({ fundamentalScore: 78, keyMetrics: { PE: 28 } })

Risk Team runs sequentially (RiskManager depends on RiskAnalyst output):
  RiskAnalyst  → report.riskAssessment = { riskLevel: 'medium', metrics: { VaR: 0.03, volatility: 0.22, ... } }
  RiskManager  → report.riskAssessment.maxPositionSize = 0.05, stopLoss = 180.00

Manager reads everything:
  report.finalDecision = { action: 'BUY', confidence: 0.73, reasoning: '...', suggestedPositionSize: 0.04 }
```

---

## Testing approach

Every test mocks its external SDK. No real API calls are made anywhere. This means:

- Tests run instantly with no network
- No API keys needed to run tests
- Each adapter is tested in isolation

Run all tests:
```bash
npm test
```

Run a single test file:
```bash
npm test -- tests/llm/openai.test.ts
```

Watch mode:
```bash
npm run test:watch
```

---

## What was built (Plan 2 — Data & RAG)

### 1. Data source layer (`src/data/`)

`IDataSource` is the interface every data adapter implements:

```ts
interface IDataSource {
  readonly name: string
  fetch(query: DataQuery): Promise<DataResult>
}
```

Adapters built:

| File | Market | Data |
|------|--------|------|
| `YFinanceSource.ts` | US | OHLCV, fundamentals via yfinance HTTP |
| `PolygonSource.ts` | US | OHLCV, news via Polygon.io REST API |
| `NewsAPISource.ts` | US | News articles via NewsAPI |
| `FinnhubSource.ts` | US | Fundamentals, technicals via Finnhub |
| `SECEdgarSource.ts` | US | Filings via SEC EDGAR full-text search |
| `TushareSource.ts` | CN | A-shares OHLCV via Tushare HTTP API |
| `AkShareSource.ts` | CN/HK | A-shares + HK equities via AkShare |

### 2. RAG layer (`src/rag/`)

- **`IVectorStore`** — interface for upsert / search / delete
- **`QdrantVectorStore`** — implementation backed by Qdrant (`@qdrant/js-client-rest`)
- **`Embedder`** — wraps OpenAI-compatible embeddings, exposes `embed()` and `embedBatch()`
- **`chunker.ts`** — splits long text into overlapping chunks with configurable size and overlap

### 3. DataFetcher agent (`src/agents/data/DataFetcher.ts`)

The first stage of the pipeline. Given a `TradingReport` with ticker + market:

1. Fans out to all configured `IDataSource` adapters × 4 data types in parallel
2. Chunks each result, embeds it, and upserts into the vector store (if configured)
3. Writes raw `DataResult[]` to `report.rawData`

---

## What was built (Plan 3 — Agents & Evaluation)

### 1. parseJson utility (`src/utils/parseJson.ts`)

LLMs often wrap JSON in markdown code fences. `parseJson<T>(text)` strips any ` ```json ` fence before calling `JSON.parse`, so all agents share one safe entry point for parsing LLM responses.

### 2. BaseResearcher (`src/agents/researcher/BaseResearcher.ts`)

Abstract base class (Template Method pattern) for all four researcher agents. Subclasses only implement two hooks:

```ts
protected abstract buildQuery(report: TradingReport): string
protected abstract buildSystemPrompt(report: TradingReport, context: string): string
```

`BaseResearcher.run()` handles:
- RAG retrieval (embeds the query, searches the vector store for relevant context)
- Building the full prompt + context
- Calling the LLM
- Parsing and validating the JSON response (stance enum check, confidence clamped to `[0,1]`)
- Falling back to `{ stance: 'neutral', confidence: 0 }` on bad LLM output

Constructor guard: throws if exactly one of `vectorStore`/`embedder` is provided (partial RAG config is always a bug).

### 3. Researcher agents

| Agent | File | Focus |
|-------|------|-------|
| `BullResearcher` | `researcher/BullResearcher.ts` | Finds BUY evidence |
| `BearResearcher` | `researcher/BearResearcher.ts` | Finds SELL evidence |
| `NewsAnalyst` | `researcher/NewsAnalyst.ts` | News sentiment, adds `sentiment` field to Finding |
| `FundamentalsAnalyst` | `researcher/FundamentalsAnalyst.ts` | Company health, adds `fundamentalScore` + `keyMetrics` |

### 4. Risk agents

- **`RiskAnalyst`** (`src/agents/risk/RiskAnalyst.ts`) — computes `riskLevel`, VaR, volatility, beta, maxDrawdown from OHLCV + research findings. Sets `report.riskAssessment`.
- **`RiskManager`** (`src/agents/risk/RiskManager.ts`) — reads `riskAssessment` and adds `maxPositionSize`, `stopLoss`, `takeProfit`. Returns early without an LLM call if no `riskAssessment` exists.

### 5. Manager (`src/agents/manager/Manager.ts`)

Reads the full report — all research findings and risk assessment — and produces the final `Decision`:

```ts
{ action: 'BUY' | 'SELL' | 'HOLD', confidence: number, reasoning: string, suggestedPositionSize?: number }
```

Fallback on bad LLM output: `{ action: 'HOLD', confidence: 0, reasoning: 'Manager was unable to parse LLM response' }`.

### 6. Orchestrator (`src/orchestrator/Orchestrator.ts`)

Wires the full pipeline:

```
Stage 1: DataFetcher (optional, skipped if not configured)
Stage 2: Researcher team — Promise.all (each agent gets a { ...report } copy; findings merged after)
Stage 3: Risk team — sequential for...of (RiskManager depends on RiskAnalyst's output)
Stage 4: Manager
```

### 7. Evaluators (`src/evaluation/`)

| Evaluator | What it measures |
|-----------|-----------------|
| `ReasoningEvaluator` | LLM-as-judge: scores `logicalConsistency`, `evidenceQuality`, `confidenceCalibration` (each 0–1) |
| `AccuracyEvaluator` | Directional accuracy (BUY+up=correct, SELL+down=correct, HOLD=0.5) + confidence calibration |
| `BacktestEvaluator` | Aggregates `AccuracyEvaluator` over a list of historical entries; computes win rate, Sharpe ratio (sample variance), max drawdown |

All three implement `IEvaluator`:

```ts
interface IEvaluator {
  evaluate(report: TradingReport): Promise<EvaluationResult>
}

type EvaluationResult = {
  score: number
  breakdown: Record<string, number>
  notes: string
}
```

---

## Repository layout

```
traderagent/
├── src/
│   ├── llm/                  LLM adapter layer (ILLMProvider, 5 adapters, registry)
│   ├── agents/
│   │   ├── base/             Shared domain types (TradingReport, Finding, Decision, …)
│   │   ├── data/             DataFetcher
│   │   ├── researcher/       BaseResearcher, Bull, Bear, News, Fundamentals
│   │   ├── risk/             RiskAnalyst, RiskManager
│   │   └── manager/          Manager
│   ├── data/                 IDataSource + US/CN/HK adapters
│   ├── rag/                  IVectorStore, QdrantVectorStore, Embedder, chunker
│   ├── orchestrator/         Orchestrator
│   ├── evaluation/           IEvaluator, Reasoning, Accuracy, Backtest evaluators
│   ├── utils/                parseJson
│   └── config/               Agent-to-LLM mapping
├── tests/                    Mirrors src/ structure, 240 tests total
└── docs/
    ├── GUIDE.md              This file
    └── superpowers/
        ├── specs/            Design documents
        └── plans/            Implementation plans (one per plan)
```

---

## Key decisions and why

**Why TypeScript over Python?**
Strong typing catches interface mismatches at compile time, not at runtime when an agent sends a malformed `TradingReport` to the next stage. For a system where agents pass structured data between them, this matters.

**Why abstract interfaces for everything?**
The LLM landscape changes fast. A provider that's best today may not be best in 6 months. Wrapping each provider behind `ILLMProvider` means you can switch without rewriting agent logic. Same for data sources and vector stores.

**Why shared state (blackboard) instead of message passing?**
Easier to debug — you can inspect the full `TradingReport` at any point and see exactly what each agent contributed. The Manager also needs full context from all prior agents to make a good decision.

**Why parallel teams?**
The Bull and Bear researchers don't depend on each other — running them in parallel halves the time for the researcher phase. Same for the risk team. Sequential execution would be needlessly slow.

**Why DeepSeek extends OpenAIProvider?**
DeepSeek's API is OpenAI-compatible. Reusing the adapter and just overriding the base URL avoids duplicating ~50 lines of code for what is functionally the same integration.
