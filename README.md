TraderAgent Project Guide

  What This Is

  A multi-agent trading analysis system that fetches market data, runs it through specialized AI agents (bull researcher, bear
  researcher, news analyst, fundamentals analyst, risk team), and produces a final BUY/SELL/HOLD decision with confidence score, stop
  loss, and take profit levels.

  Architecture

                           ┌─────────────────┐
                           │   Orchestrator   │  — 5-stage pipeline
                           └────────┬────────┘
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
      ┌──────┴──────┐     ┌────────┴────────┐    ┌────────┴────────┐
      │ Stage 1 + 2 │     │    Stage 3      │    │  Stage 4 + 5    │
      │ DataFetcher  │     │ Researcher Team │    │ Risk + Manager  │
      │ + Technical  │     │   (parallel)    │    │  (sequential)   │
      │  Analyzer    │     │                 │    │                 │
      └──────────────┘     └─────────────────┘    └─────────────────┘

  Pipeline stages:
  1. DataFetcher — pulls OHLCV, news, fundamentals from data sources; chunks + embeds into vector store
  2. TechnicalAnalyzer — computes RSI, MACD, Bollinger, ATR, VaR, beta, etc. from raw OHLCV
  3. Researcher Team (parallel) — 4 agents analyze data with different perspectives:
    - BullResearcher — looks for bullish signals
    - BearResearcher — looks for bearish signals
    - NewsAnalyst — analyzes recent news sentiment
    - FundamentalsAnalyst — evaluates PE, PB, EPS, etc.
  4. Risk Team (sequential) — RiskAnalyst classifies risk level, RiskManager sets position limits
  5. Manager — weighs all findings, produces final Decision (action, confidence, stopLoss, takeProfit)

  Key Interfaces

         ┌──────────────┬───────────────────────────┬─────────────────────────────────────────────┐
         │  Interface   │           File            │                   Purpose                   │
         ├──────────────┼───────────────────────────┼─────────────────────────────────────────────┤
         │ IAgent       │ src/agents/base/IAgent.ts │ All agents implement run(report) → report   │
         ├──────────────┼───────────────────────────┼─────────────────────────────────────────────┤
         │ ILLMProvider │ src/llm/ILLMProvider.ts   │ LLM abstraction: chat(messages) → string    │
         ├──────────────┼───────────────────────────┼─────────────────────────────────────────────┤
         │ IDataSource  │ src/data/IDataSource.ts   │ Data abstraction: fetch(query) → DataResult │
         ├──────────────┼───────────────────────────┼─────────────────────────────────────────────┤
         │ IVectorStore │ src/rag/IVectorStore.ts   │ RAG storage: upsert, search, delete         │
         ├──────────────┼───────────────────────────┼─────────────────────────────────────────────┤
         │ IEmbedder    │ src/rag/IEmbedder.ts      │ Embedding: embed(text) → number[]           │
         └──────────────┴───────────────────────────┴─────────────────────────────────────────────┘

                                            

  Core Types

  Defined in src/agents/base/types.ts:
  - TradingReport — the pipeline's shared state, flows through all agents
  - Decision — final output: action (BUY/SELL/HOLD), confidence, reasoning, stopLoss, takeProfit
  - Finding — each researcher's output: stance, evidence, confidence
  - RiskAssessment — risk level + metrics (VaR, volatility, beta, maxDrawdown)
  - Market — 'US' | 'CN' | 'HK'

  LLM Configuration

  src/config/config.ts maps agent names to LLM providers:

       ┌──────────────────┬──────────┬───────────────────┬──────────────────────────────────────────────┐
       │   Agent Group    │ Provider │       Model       │                  Rationale                   │
       ├──────────────────┼──────────┼───────────────────┼──────────────────────────────────────────────┤
       │ Research team    │ DeepSeek │ deepseek-chat     │ Fast, cost-effective for evidence gathering  │
       ├──────────────────┼──────────┼───────────────────┼──────────────────────────────────────────────┤
       │ Risk + Manager   │ DeepSeek │ deepseek-reasoner │ Deep chain-of-thought for critical decisions │
       ├──────────────────┼──────────┼───────────────────┼──────────────────────────────────────────────┤
       │ Trainer pipeline │ Ollama   │ llama3.1          │ Local, free for iterative backtesting        │
       └──────────────────┴──────────┴───────────────────┴──────────────────────────────────────────────┘

  Supported providers: OpenAI, Anthropic, Gemini, Ollama, DeepSeek (src/llm/registry.ts)

  Data Sources

  - PostgresDataSource — local DB cache (Prisma + PostgreSQL)
  - FinnhubSource — Finnhub API (requires FINNHUB_API_KEY)
  - YFinanceSource — Yahoo Finance (no key needed, always available)
  - FallbackDataSource — tries sources in order, first success wins
  - RateLimitedDataSource — wraps any source with per-source rate limiting + 429 retry

  RAG System

  Auto-detected via detectRAGMode():
  - qdrant mode: Qdrant vector DB + OpenAI embeddings (needs QDRANT_URL + OPENAI_API_KEY)
  - memory mode: In-memory vector store + Ollama embeddings (needs OLLAMA_HOST)
  - disabled: no RAG, agents work without context retrieval

  RAG stores chunked market data and learned lessons from the trader training loop.

  Trader Training System

  The newest module (src/agents/trader/). A backtesting + lesson extraction loop:

  ┌──────────┐     ┌────────────┐     ┌──────────────────┐     ┌─────────────────┐
  │ TraderAgent│────▶│ Backtester  │────▶│ CompositeScorer   │────▶│ LessonExtractor  │
  │  .train() │     │  .replay()  │     │  .score()         │     │  .extract()      │
  └──────────┘     └────────────┘     └──────────────────┘     └────────┬────────┘
                                                                        │
                                                                ┌───────▼────────┐
                                                                │ LessonsJournal  │
                                                                │  → vector store │
                                                                └────────────────┘

  1. Splits OHLCV data into 70% train / 30% test windows
  2. Replays each bar through the full orchestrator pipeline
  3. Scores decisions with CompositeScorer (directional accuracy 30%, target hit 30%, calibration 25%, hold penalty 15%)                  4. LessonExtractor uses LLM to analyze patterns in scored decisions
  5. Lessons stored in vector store via LessonsJournal, fed back to researchers + manager on next pass
  6. Early stopping when test score stagnates

  Database Schema

  PostgreSQL via Prisma (prisma/schema.prisma):
  - Watchlist — tracked tickers
  - Ohlcv — cached price data
  - Fundamentals, News, Technicals — cached research data
  - FetchLog — data source fetch audit trail
  - BacktestRun, BacktestDecision, Lesson — trader training results

  CLI Commands

        ┌──────────────────────────────────────────────────────────┬─────────────────────────────────────────┐
        │                         Command                          │              What it does               │                                  ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run run:analyze -- AAPL US                           │ Run full analysis pipeline for a ticker │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤                                
        │ npm run trader:train -- AAPL US --passes 4 --lookback 12 │ Train trader with backtesting loop      │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run watchlist:add -- AAPL US                         │ Add ticker to watchlist                 │                                  ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run watchlist:list                                   │ Show watchlist                          │                                  ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤                                  
        │ npm run db:sync -- AAPL US                               │ Sync market data to Postgres            │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run scheduler:start                                  │ Start cron-based auto-sync              │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run test                                             │ Run all tests                           │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run typecheck                                        │ TypeScript type check                   │
        └──────────────────────────────────────────────────────────┴─────────────────────────────────────────┘

  Environment Variables

  # Required for production analysis
  DEEPSEEK_API_KEY=...          # Research + risk + manager agents

  # Optional — data sources
  DATABASE_URL=...              # PostgreSQL (docker-compose provides one)
  FINNHUB_API_KEY=...           # Finnhub market data

  # Optional — RAG (pick one pair)
  QDRANT_URL=... + OPENAI_API_KEY=...   # Full RAG mode
  OLLAMA_HOST=http://localhost:11434    # Local RAG mode

  # Optional — alternative LLMs
  ANTHROPIC_API_KEY=...
  GEMINI_API_KEY=...

  Quick Start

  # 1. Start Postgres
  docker compose up -d

  # 2. Set up env
  cp .env.example .env  # fill in DEEPSEEK_API_KEY at minimum

  # 3. Database
  npm run db:generate
  npm run db:migrate

  # 4. Run analysis
  npm run run:analyze -- AAPL US

  # 5. Train trader (optional — needs Ollama running)
  npm run trader:train -- AAPL US

  Project Structure

     src/                                                                                                                                    
     ├── agents/
     │   ├── base/           IAgent, types (TradingReport, Decision, Finding...)
     │   ├── data/           DataFetcher (stage 1)
     │   ├── analyzer/       TechnicalAnalyzer (stage 2)
     │   ├── researcher/     BaseResearcher, Bull/Bear/News/Fundamentals (stage 3)
     │   ├── risk/           RiskAnalyst, RiskManager (stage 4)
     │   ├── manager/        Manager (stage 5)
     │   └── trader/         TraderAgent, Backtester, CompositeScorer, LessonExtractor, LessonsJournal
     ├── cli/                Entry points: run, train, sync, watchlist, scheduler
     ├── config/             Agent LLM config, rate limit config
     ├── data/               Data source implementations (Finnhub, YFinance, Polygon, etc.)
     ├── db/                 Prisma client, PostgresDataSource
     ├── evaluation/         Accuracy/Backtest/Reasoning evaluators
     ├── indicators/         Technical indicator calculations (RSI, MACD, Bollinger, etc.)
     ├── llm/                LLM providers (OpenAI, Anthropic, Gemini, Ollama, DeepSeek) + registry
     ├── orchestrator/       Orchestrator (wires the 5-stage pipeline)
     ├── rag/                Vector store (Qdrant, InMemory), embedders, chunker
     ├── sync/               DataSyncService, Scheduler
     └── utils/              parseJson
     tests/
     ├── agents/trader/      6 test files, 29 tests
     └── agents/             DataFetcher, TechnicalAnalyzer, BullResearcher tests