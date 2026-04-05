TraderAgent Project Guide

  What This Is

  A multi-agent trading analysis system that fetches market data, runs it through specialized AI agents (bull researcher, bear
  researcher, news analyst, fundamentals analyst, risk team), and produces a final 5-tier recommendation
  (BUY/OVERWEIGHT/HOLD/UNDERWEIGHT/SELL) with confidence score, stop loss, and take profit levels.

  Architecture

                           ┌─────────────────┐
                           │   Orchestrator   │  — 5-stage pipeline
                           └────────┬────────┘
             ┌──────────────────────┼──────────────────────┐
             │                      │                      │
      ┌──────┴──────┐     ┌────────┴────────┐    ┌────────┴────────┐
      │ Stage 1 + 2 │     │    Stage 3      │    │  Stage 4 + 5    │
      │ DataFetcher  │     │ Researcher Team │    │ Risk + Manager  │
      │ + Technical  │     │ (parallel or    │    │  (sequential or │
      │  Analyzer    │     │  debate mode)   │    │   debate mode)  │
      └──────────────┘     └─────────────────┘    └─────────────────┘

  Pipeline stages:
  1. DataFetcher — pulls OHLCV, news, fundamentals from data sources; chunks + embeds into vector store
  2. TechnicalAnalyzer — computes RSI, MACD, Bollinger, ATR, VaR, beta, etc. from raw OHLCV
  3. Researcher Team — configurable analysts with optional debate mode:
    - BullResearcher — looks for bullish signals
    - BearResearcher — looks for bearish signals
    - NewsAnalyst — analyzes recent news sentiment
    - FundamentalsAnalyst — evaluates PE, PB, EPS, etc.
    - DebateEngine (optional) — Bull and Bear counter each other's arguments over configurable rounds
    - ResearchManager (optional) — synthesizes debate into a balanced investment thesis
  4. Risk Team — two modes:
    - Classic: RiskAnalyst classifies risk level, RiskManager sets position limits
    - Debate: Aggressive/Conservative/Neutral risk analysts debate, PortfolioManager synthesizes
  5. Manager — weighs all findings, produces final Decision (5-tier action, confidence, stopLoss, takeProfit)

  5-Tier Rating Scale

  Instead of a simple BUY/SELL/HOLD, the system uses a nuanced 5-tier scale:

  | Tier        | Direction | Meaning                                      |
  |-------------|-----------|----------------------------------------------|
  | BUY         | +1.0      | Strong conviction to enter/add a long         |
  | OVERWEIGHT  | +0.5      | Moderately bullish, increase position          |
  | HOLD        |  0.0      | Neutral, maintain current position             |
  | UNDERWEIGHT | -0.5      | Moderately bearish, reduce position            |
  | SELL        | -1.0      | Strong conviction to exit/short                |

  Research Debate System

  When `debateEnabled: true` in PipelineConfig, the Bull and Bear researchers engage in adversarial rounds:

       Round 1: Bull argues → Bear rebuts → Bull rebuts Bear
       Round 2: Repeat with stronger arguments
       ...
       ResearchManager synthesizes debate into a balanced Finding

  This prevents confirmation bias by forcing each side to address the other's evidence directly.
  Configurable via `maxDebateRounds` (default: 2).

  Risk Debate System

  When `riskDebateEnabled: true`, three risk analysts with different philosophies run in parallel:

       ┌─────────────┐  ┌──────────────────┐  ┌───────────────┐
       │  Aggressive  │  │   Conservative   │  │    Neutral    │
       │ Risk Analyst │  │  Risk Analyst    │  │ Risk Analyst  │
       └──────┬───────┘  └────────┬─────────┘  └───────┬───────┘
              └──────────────────┬┘─────────────────────┘
                        ┌───────┴────────┐
                        │  Portfolio     │
                        │  Manager       │
                        └────────────────┘

  The PortfolioManager synthesizes all three viewpoints into a balanced risk assessment.

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
  - ActionTier — 'BUY' | 'OVERWEIGHT' | 'HOLD' | 'UNDERWEIGHT' | 'SELL'
  - Decision — final output: action (ActionTier), confidence, reasoning, stopLoss, takeProfit
  - Finding — each researcher's output: stance, evidence, confidence
  - RiskAssessment — risk level + metrics (VaR, volatility, beta, maxDrawdown)
  - Market — 'US' | 'CN' | 'HK'

  Pipeline Configuration

  Defined in src/config/config.ts as PipelineConfig:

  | Option            | Type       | Default | Description                                       |
  |-------------------|------------|---------|---------------------------------------------------|
  | enabledAnalysts   | string[]   | all 4   | Which analysts to run: bull, bear, news, fundamentals |
  | debateEnabled     | boolean    | false   | Enable Bull vs Bear adversarial debate rounds     |
  | maxDebateRounds   | number     | 2       | Number of debate rounds when debate is enabled    |
  | riskDebateEnabled | boolean    | false   | Enable 3-way risk analyst debate + PortfolioManager |
  | outputLanguage    | string     | 'en'    | Output language: 'en', 'zh', 'ja', 'ko', etc.    |
  | ragMode           | RAGMode    | auto    | 'qdrant', 'memory', 'bm25', or 'disabled'        |

  Use buildOrchestrator() from src/orchestrator/OrchestratorFactory.ts to wire everything together
  based on a PipelineConfig.

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

  Supported providers: OpenAI, Anthropic, Gemini, Ollama, DeepSeek, SiliconFlow (src/llm/registry.ts)

  LLM Response Normalization: All providers normalize responses via src/llm/normalizeResponse.ts,
  handling reasoning blocks, text blocks, and structured outputs from different providers uniformly.

  Data Sources

  - PostgresDataSource — local DB cache (Prisma + PostgreSQL)
  - FinnhubSource — Finnhub API (requires FINNHUB_API_KEY)
  - YFinanceSource — Yahoo Finance (no key needed, always available)
  - FallbackDataSource — tries sources in order, first success wins
  - RateLimitedDataSource — wraps any source with per-source rate limiting + 429 retry
  - DateFilteredDataSource — wraps any source with a date cutoff to prevent look-ahead bias in backtesting

  RAG System

  Auto-detected via detectRAGMode():
  - qdrant mode: Qdrant vector DB + OpenAI embeddings (needs QDRANT_URL + OPENAI_API_KEY)
  - memory mode: In-memory vector store + Ollama embeddings (needs OLLAMA_HOST)
  - bm25 mode: BM25 keyword search — no API keys needed, offline text retrieval (set RAG_BM25=true)
  - disabled: no RAG, agents work without context retrieval

  BM25 Memory System: A pure TypeScript BM25 implementation (src/rag/BM25Index.ts) provides keyword-based
  document retrieval without embeddings or API calls. BM25VectorStore implements the IVectorStore interface,
  making it a drop-in fallback when no embedding API is available.

  RAG stores chunked market data and learned lessons from the trader training loop.

  Trader Training System

  The training module (src/agents/trader/). A backtesting + lesson extraction + reflection loop:

       ┌──────────┐     ┌────────────┐     ┌──────────────────┐     ┌─────────────────┐
       │ TraderAgent│────▶│ Backtester  │────▶│ CompositeScorer   │────▶│ LessonExtractor  │
       │  .train() │     │  .replay()  │     │  .score()         │     │  .extract()      │
       └──────────┘     └────────────┘     └──────────────────┘     └────────┬────────┘
                                                                        │
                                                                ┌───────▼────────┐
                                                                │ LessonsJournal  │
                                                                │  → vector store │
                                                                └───────┬────────┘
                                                                        │
                                                                ┌───────▼────────────┐
                                                                │ ReflectionEngine    │
                                                                │  → structured       │
                                                                │    post-trade       │
                                                                │    reflection       │
                                                                └────────────────────┘

  1. Splits OHLCV data into 70% train / 30% test windows
  2. Replays each bar through the full orchestrator pipeline (with look-ahead bias prevention)
  3. Scores decisions with CompositeScorer (directional accuracy 30%, target hit 30%, calibration 25%, hold penalty 15%)
  4. LessonExtractor uses LLM to analyze patterns in scored decisions
  5. Lessons stored in vector store via LessonsJournal, fed back to researchers + manager on next pass
  6. ReflectionEngine analyzes worst-performing decisions: what worked, what failed, adjustments needed
  7. Reflection adjustments stored as lessons for future retrieval
  8. Early stopping when test score stagnates

  Look-Ahead Bias Prevention: DateFilteredDataSource wraps all data sources during backtesting,
  ensuring agents only see data available up to the simulated current date.

  Output Language Support

  Set OUTPUT_LANGUAGE env var or configure outputLanguage in PipelineConfig. Supported: en, zh, zh-TW, ja, ko.
  All LLM system prompts are automatically appended with a language instruction.

  Database Schema

  PostgreSQL via Prisma (prisma/schema.prisma):
  - Watchlist — tracked tickers
  - Ohlcv — cached price data
  - Fundamentals, News, Technicals — cached research data
  - FetchLog — data source fetch audit trail
  - BacktestRun, BacktestDecision, Lesson — trader training results

  CLI Commands

        ┌──────────────────────────────────────────────────────────┬─────────────────────────────────────────┐
        │                         Command                          │              What it does               │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run run:analyze -- AAPL US                           │ Run full analysis pipeline for a ticker │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run trader:train -- AAPL US --passes 4 --lookback 12 │ Train trader with backtesting loop      │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run watchlist:add -- AAPL US                         │ Add ticker to watchlist                 │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run watchlist:list                                   │ Show watchlist                          │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
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

  # Optional — RAG (pick one)
  QDRANT_URL=... + OPENAI_API_KEY=...   # Full RAG mode (Qdrant + OpenAI embeddings)
  OLLAMA_HOST=http://localhost:11434    # Local RAG mode (in-memory + Ollama embeddings)
  RAG_BM25=true                         # BM25 keyword search mode (no API keys needed)

  # Optional — alternative LLMs
  ANTHROPIC_API_KEY=...
  GEMINI_API_KEY=...

  # Optional — output language
  OUTPUT_LANGUAGE=en            # en, zh, zh-TW, ja, ko

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
     │   ├── base/           IAgent, types (TradingReport, Decision, Finding, ActionTier...)
     │   ├── data/           DataFetcher (stage 1)
     │   ├── analyzer/       TechnicalAnalyzer (stage 2)
     │   ├── researcher/     BaseResearcher, Bull/Bear/News/Fundamentals, DebateEngine, ResearchManager (stage 3)
     │   ├── risk/           RiskAnalyst, RiskManager, Aggressive/Conservative/Neutral analysts, PortfolioManager (stage 4)
     │   ├── manager/        Manager (stage 5)
     │   ├── advisor/        AdvisorAgent, MarketTrendAnalyzer, AdvisorScheduler
     │   └── trader/         TraderAgent, Backtester, CompositeScorer, LessonExtractor, LessonsJournal, ReflectionEngine
     ├── cli/                Entry points: run, train, sync, watchlist, scheduler, advisor
     ├── config/             Agent LLM config, PipelineConfig, rate limit config
     ├── data/               Data source implementations (Finnhub, YFinance, Polygon, DateFilteredDataSource, etc.)
     ├── db/                 Prisma client, PostgresDataSource
     ├── evaluation/         Accuracy/Backtest/Reasoning evaluators
     ├── indicators/         Technical indicator calculations (RSI, MACD, Bollinger, etc.)
     ├── llm/                LLM providers (OpenAI, Anthropic, Gemini, Ollama, DeepSeek, SiliconFlow) + registry + normalizeResponse
     ├── orchestrator/       Orchestrator (5-stage pipeline with debate support) + OrchestratorFactory
     ├── rag/                Vector store (Qdrant, InMemory, BM25), embedders, chunker
     ├── sync/               DataSyncService, Scheduler
     ├── messaging/          WhatsApp message sender
     └── utils/              parseJson, logger (Pino), i18n, errors, normalizeOhlcv
     tests/                  57 test files, 274 tests


Reference:
   @misc{xiao2025tradingagentsmultiagentsllmfinancial,
      title={TradingAgents: Multi-Agents LLM Financial Trading Framework}, 
      author={Yijia Xiao and Edward Sun and Di Luo and Wei Wang},
      year={2025},
      eprint={2412.20138},
      archivePrefix={arXiv},
      primaryClass={q-fin.TR},
      url={https://arxiv.org/abs/2412.20138}, 
      }