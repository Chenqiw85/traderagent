# TradingAgent

A multi-agent trading suggestion platform built on RAG (Retrieval-Augmented Generation). Specialized agents collaborate to produce **BUY / SELL / HOLD** decisions with confidence scores and reasoning — grounded in real market data.

---

## What it does

You give it a ticker and a market. A team of AI agents goes to work:

1. **DataFetcher** pulls market data, news, fundamentals, and technical indicators — embeds everything into a vector store
2. **Researcher Team** (runs in parallel) — a Bull agent finds reasons to buy, a Bear agent finds reasons to sell, a News agent reads sentiment, a Fundamentals agent checks company health
3. **Risk Team** (runs in parallel) — evaluates volatility, VaR, drawdown, and sets position sizing and stop-loss levels
4. **Manager** reads every agent's findings and makes the final call

Every agent can use a **different LLM** (OpenAI, Anthropic, Gemini, Ollama, DeepSeek). Every data source and vector store is behind an interface, so you can swap them out without touching agent logic.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  LLM Layer        ILLMProvider                              │
│                   OpenAI · Anthropic · Gemini               │
│                   Ollama · DeepSeek                         │
├─────────────────────────────────────────────────────────────┤
│  Data Layer       IDataSource                               │
│  (Plan 2)         yfinance · Polygon · NewsAPI · SEC EDGAR  │
│                   Tushare · AkShare (CN/HK markets)         │
├─────────────────────────────────────────────────────────────┤
│  RAG Layer        IVectorStore → Qdrant                     │
│  (Plan 2)         Embedder → chunk · embed · store          │
├─────────────────────────────────────────────────────────────┤
│  Agent Layer      (Plan 3)                                  │
│                                                             │
│  ① DataFetcher                                              │
│  ② Researcher Team ──────────────────────┐                 │
│     BullResearcher  BearResearcher        │                 │
│     NewsAnalyst     FundamentalsAnalyst   ├─► TradingReport │
│  ③ Risk Team ────────────────────────────┤                 │
│     RiskAnalyst     RiskManager           │                 │
│  ④ Manager ──────────────────────────────┘                 │
│     → Decision { BUY|SELL|HOLD, confidence, reasoning }    │
├─────────────────────────────────────────────────────────────┤
│  Evaluation       IEvaluator (Plan 3)                       │
│                   Reasoning · Accuracy · Backtest           │
└─────────────────────────────────────────────────────────────┘
```

Agents communicate through a **shared `TradingReport`** (blackboard pattern). Each agent reads the current state, appends its findings, and passes it on.

---

## Current status

| Plan | What | Status |
|------|------|--------|
| Plan 1 — Foundation | TypeScript setup, all domain types, LLM adapters (5 providers), LLMRegistry, config | ✅ Done |
| Plan 2 — Data & RAG | Data source adapters (US + CN), Qdrant vector store, embedder, DataFetcher | 🔜 Next |
| Plan 3 — Agents & Evaluation | All 7 agents, Orchestrator, 3 evaluators | 🔜 Upcoming |

---

## Supported markets

- **US Equities** — NYSE, NASDAQ
- **Chinese A-shares** — Shanghai, Shenzhen
- **Hong Kong** — HKEX

---

## Quick start

```bash
# Clone and install
git clone <repo>
cd traderagent
npm install

# Run tests
npm test

# Type check
npm run typecheck
```

### Environment variables

Copy `.env.example` to `.env` and fill in the keys for the providers you want to use:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...
DEEPSEEK_API_KEY=sk-...
OLLAMA_HOST=http://localhost:11434   # optional, defaults to localhost
```

You only need keys for the providers you actually use. See `src/config/config.ts` to change which LLM each agent uses.

---

## Configuring agents

Each agent can use a different LLM. Edit `src/config/config.ts`:

```ts
export const agentConfig = {
  bullResearcher:      { llm: 'openai',    model: 'gpt-4o' },
  bearResearcher:      { llm: 'anthropic', model: 'claude-sonnet-4-6' },
  newsAnalyst:         { llm: 'gemini',    model: 'gemini-2.0-flash' },
  fundamentalsAnalyst: { llm: 'deepseek',  model: 'deepseek-chat' },
  riskAnalyst:         { llm: 'gemini',    model: 'gemini-2.0-flash' },
  riskManager:         { llm: 'openai',    model: 'gpt-4o-mini' },
  manager:             { llm: 'openai',    model: 'o3-mini' },
}
```

---

## Project structure

```
src/
├── llm/              LLM provider layer
│   ├── ILLMProvider.ts
│   ├── types.ts      Message, LLMOptions
│   ├── openai.ts
│   ├── anthropic.ts
│   ├── gemini.ts
│   ├── ollama.ts
│   ├── deepseek.ts
│   └── registry.ts   resolves providers by agent name
├── agents/base/
│   └── types.ts      TradingReport, Finding, Decision, etc.
├── config/
│   └── config.ts     agent → LLM mapping
└── (data/, rag/, agents/, orchestrator/, evaluation/ — Plan 2 & 3)
```

---

## Docs

- [Design spec](docs/superpowers/specs/2026-03-25-traderagent-design.md) — full architecture decisions
- [Plan 1 — Foundation](docs/superpowers/plans/2026-03-25-foundation.md) — implementation plan (completed)

---

## Tech stack

- **Language:** TypeScript 5.4, ESM
- **Testing:** Vitest
- **LLM SDKs:** openai, @anthropic-ai/sdk, @google/generative-ai, ollama
- **Vector store:** Qdrant (Plan 2)
- **Market data:** yfinance, Polygon.io, Tushare, AkShare (Plan 2)
