# TradingAgent Platform — Design Spec

**Date:** 2026-03-25
**Stack:** TypeScript
**Status:** Approved

---

## Overview

A multi-agent trading suggestion platform built on RAG. Specialized agents form two teams (Researcher, Risk) that run in parallel and write findings to a shared `TradingReport`. A Manager agent reads the full report and produces a final `BUY / SELL / HOLD` decision with confidence, reasoning, and position sizing.

All LLM providers, data sources, and the vector store are accessed through abstract interfaces, making every dependency swappable via config.

---

## 1. Target Markets & Asset Classes

- **US Equities** — NYSE, NASDAQ (via yfinance, Polygon.io, Alpha Vantage, SEC EDGAR)
- **Chinese Markets** — A-shares (Shanghai, Shenzhen) and HK (via Tushare, AkShare, East Money)

---

## 2. Core Interfaces

### 2.1 LLM Layer — `ILLMProvider`

```ts
interface ILLMProvider {
  name: string
  chat(messages: Message[], options?: LLMOptions): Promise<string>
  chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string>
}
```

**Adapters:** `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider`, `OllamaProvider`, `DeepSeekProvider`

Each adapter is independently configured and any agent can use any provider via `config.ts`.

### 2.2 Data Layer — `IDataSource`

```ts
interface IDataSource {
  name: string
  fetch(query: DataQuery): Promise<DataResult>
}

type DataQuery = {
  ticker: string
  market: 'US' | 'CN' | 'HK'
  type: 'ohlcv' | 'news' | 'fundamentals' | 'technicals'
  from?: Date
  to?: Date
}
```

**Adapters:** `YFinanceSource`, `PolygonSource`, `AlphaVantageSource`, `TushareSource`, `AkShareSource`, `NewsAPISource`, `FinnhubSource`, `SECEdgarSource`

> **Note on CN data sources:** Tushare and AkShare are Python libraries. Two options: (a) wrap them in a lightweight Python FastAPI microservice and call via HTTP from the TypeScript adapter, or (b) use their HTTP APIs directly where available. `TushareSource` and `AkShareSource` adapters will call these HTTP endpoints. The `IDataSource` interface is unchanged.

### 2.3 Vector Store — `IVectorStore`

```ts
interface IVectorStore {
  upsert(docs: Document[]): Promise<void>
  search(query: string, topK: number, filter?: MetadataFilter): Promise<Document[]>
  delete(ids: string[]): Promise<void>
}
```

**Primary adapter:** `QdrantVectorStore`. Interface allows future adapters (Pinecone, Chroma) without changing agent code.

### 2.4 Agent Interface & Shared State

```ts
type AgentRole = 'researcher' | 'risk' | 'manager' | 'data'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

type DataResult = {
  ticker: string
  market: 'US' | 'CN' | 'HK'
  type: 'ohlcv' | 'news' | 'fundamentals' | 'technicals'
  data: unknown        // raw payload from source
  fetchedAt: Date
}

type Finding = {
  agentName: string
  stance: 'bull' | 'bear' | 'neutral'
  evidence: string[]
  confidence: number   // 0–1
  sentiment?: string
  fundamentalScore?: number
  keyMetrics?: Record<string, number>
}

type RiskAssessment = {
  riskLevel: 'low' | 'medium' | 'high'
  metrics: { VaR: number; volatility: number; beta: number; maxDrawdown: number }
  maxPositionSize?: number
  stopLoss?: number
  takeProfit?: number
}

interface IAgent {
  name: string
  role: AgentRole
  run(report: TradingReport): Promise<TradingReport>
}

type TradingReport = {
  ticker: string
  market: 'US' | 'CN' | 'HK'
  timestamp: Date
  rawData: DataResult[]
  researchFindings: Finding[]
  riskAssessment?: RiskAssessment
  finalDecision?: Decision
}

type Decision = {
  action: 'BUY' | 'SELL' | 'HOLD'
  confidence: number               // 0–1
  reasoning: string
  suggestedPositionSize?: number
  stopLoss?: number
  takeProfit?: number
  agentWeights?: Record<string, number>
}
```

---

## 3. System Architecture

```
LLM Layer      ILLMProvider → OpenAI | Anthropic | Gemini | Ollama | DeepSeek
Data Layer     IDataSource  → MarketData | News | Fundamentals | Technicals (US + CN)
RAG Layer      IVectorStore → QdrantVectorStore

Agent Layer (per analysis request):
  ① DataFetcher          — fetches all data sources, chunks, embeds, stores in Qdrant
  ② Researcher Team      — [PARALLEL]
       BullResearcher        — finds BUY evidence via RAG
       BearResearcher        — finds SELL evidence via RAG
       NewsAnalyst           — summarises sentiment from news
       FundamentalsAnalyst   — assesses company fundamentals
  ③ Risk Team            — [PARALLEL, runs after Researcher Team]
       RiskAnalyst           — computes VaR, volatility, beta, max drawdown
       RiskManager           — determines position sizing, stop-loss, take-profit
  ④ Manager              — reads full TradingReport → outputs Decision

Shared State:  TradingReport (blackboard pattern)
Evaluation:    IEvaluator → ReasoningEvaluator | AccuracyEvaluator | BacktestEvaluator
Config:        Assigns a specific ILLMProvider to each agent
```

---

## 4. Agent Teams

### 4.1 Researcher Team (parallel)

| Agent | RAG Filter | Prompt Stance | Writes to TradingReport |
|---|---|---|---|
| `BullResearcher` | price, technicals, fundamentals | Find BUY evidence | `Finding { stance: 'bull', evidence[], confidence }` |
| `BearResearcher` | price, technicals, fundamentals | Find SELL evidence | `Finding { stance: 'bear', evidence[], confidence }` |
| `NewsAnalyst` | news, sentiment | Summarise market sentiment | `Finding { stance, sentiment, sources[] }` |
| `FundamentalsAnalyst` | fundamentals, filings | Assess company health | `Finding { fundamentalScore, keyMetrics[] }` |

### 4.2 Risk Team (parallel)

| Agent | Reads | Writes |
|---|---|---|
| `RiskAnalyst` | price history + research findings | `RiskAssessment { metrics: { VaR, volatility, beta, maxDrawdown }, riskLevel }` |
| `RiskManager` | riskAssessment + research findings | `RiskAssessment { maxPositionSize, stopLoss, takeProfit }` |

### 4.3 Manager Agent

Reads the full `TradingReport` (all findings, risk assessment, raw data) and outputs a `Decision`. The Manager prompt weighs conflicting bull/bear evidence against the risk assessment, and justifies the final action in plain language.

---

## 5. RAG Pipeline

For each analysis request:

1. **Fetch** — `DataFetcher` calls all configured `IDataSource` adapters for the ticker
2. **Chunk** — split text into overlapping chunks (configurable size/overlap)
3. **Embed** — `text-embedding-3-small` (OpenAI) or swappable embedding model
4. **Store** — upsert to Qdrant with metadata `{ ticker, market, source, type, date }`
5. **Retrieve** — each agent queries Qdrant filtered by `ticker + type` (top-K)
6. **Inject** — retrieved chunks prepended to the agent's system prompt as context

---

## 6. Evaluation Layer

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

| Evaluator | When | Method |
|---|---|---|
| `ReasoningEvaluator` | After each run (online) | LLM-as-judge scores each agent's Finding for logical consistency, evidence quality, confidence calibration |
| `AccuracyEvaluator` | N days after prediction | Compares Decision to actual price movement; measures directional accuracy and confidence calibration |
| `BacktestEvaluator` | On demand (offline) | Runs full pipeline over historical date range; reports Sharpe ratio, max drawdown, per-agent contribution |

---

## 7. Project Structure

```
src/
├── llm/
│   ├── ILLMProvider.ts
│   ├── openai.ts
│   ├── anthropic.ts
│   ├── gemini.ts
│   ├── ollama.ts
│   └── deepseek.ts
├── data/
│   ├── IDataSource.ts
│   ├── yfinance.ts
│   ├── polygon.ts
│   ├── tushare.ts
│   ├── akshare.ts
│   ├── newsapi.ts
│   └── secedgar.ts
├── rag/
│   ├── IVectorStore.ts
│   ├── qdrant.ts
│   └── embedder.ts
├── agents/
│   ├── base/
│   │   ├── IAgent.ts
│   │   └── TradingReport.ts
│   ├── researcher/
│   │   ├── BullResearcher.ts
│   │   ├── BearResearcher.ts
│   │   ├── NewsAnalyst.ts
│   │   └── FundamentalsAnalyst.ts
│   ├── risk/
│   │   ├── RiskAnalyst.ts
│   │   └── RiskManager.ts
│   └── manager/
│       └── Manager.ts
├── orchestrator/
│   └── Orchestrator.ts       # runs teams in parallel, assembles TradingReport
├── evaluation/
│   ├── IEvaluator.ts
│   ├── ReasoningEvaluator.ts
│   ├── AccuracyEvaluator.ts
│   └── BacktestEvaluator.ts
└── config/
    └── config.ts             # LLM + data source assignment per agent
```

---

## 8. Configuration Example

```ts
// config.ts
export const agentConfig = {
  bullResearcher:       { llm: 'openai',    model: 'gpt-4o' },
  bearResearcher:       { llm: 'anthropic', model: 'claude-sonnet-4-6' },
  newsAnalyst:          { llm: 'gemini',    model: 'gemini-2.0-flash' },
  fundamentalsAnalyst:  { llm: 'deepseek',  model: 'deepseek-chat' },
  riskAnalyst:          { llm: 'gemini',    model: 'gemini-2.0-flash' },
  riskManager:          { llm: 'openai',    model: 'gpt-4o-mini' },
  manager:              { llm: 'openai',    model: 'o3-mini' },
}

export const dataSourceConfig = {
  US: ['yfinance', 'polygon', 'newsapi', 'secedgar'],
  CN: ['tushare', 'akshare'],
  HK: ['akshare'],
}
```
