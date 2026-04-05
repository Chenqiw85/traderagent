TraderAgent Project Guide

  What This Is

  A multi-agent trading analysis system that fetches market data, runs it through specialized AI agents, and moves through an
  explicit live decision flow:

  `research findings -> research thesis -> trader proposal -> risk verdict -> final 5-tier decision`

  The final output is a recommendation in the 5-tier scale
  (BUY/OVERWEIGHT/HOLD/UNDERWEIGHT/SELL) with confidence score, stop loss, and take profit levels. When `DATABASE_URL` is set,
  live analysis runs are also persisted to Postgres with per-stage artifacts and a structured snapshot.

  Architecture

                           ┌─────────────────┐
                           │   Orchestrator   │  — live decision pipeline
                           └────────┬────────┘
             ┌──────────────────────────────────────────────────────────────────────────────┐
             │                                                                              │
      ┌──────┴──────┐     ┌────────┴────────┐    ┌────────┴────────┐    ┌────────┴────────┐
      │ Stage 1 + 2 │     │ Stage 3 + 4     │    │    Stage 5      │    │   Stage 6 + 7   │
      │ DataFetcher  │     │ Research Team + │    │  TradePlanner   │    │ Risk Team +     │
      │ + Technical  │     │ ResearchManager │    │                 │    │ Final Manager   │
      │  Analyzer    │     │                 │    │                 │    │                 │
      └──────────────┘     └─────────────────┘    └─────────────────┘    └─────────────────┘

  Pipeline stages:
  1. DataFetcher — pulls OHLCV, news, fundamentals from the configured data-source chain and stores retrievable context
  2. TechnicalAnalyzer — computes RSI, MACD, Bollinger, ATR, VaR, beta, etc. from raw OHLCV
  3. Researcher Team — configurable analysts with optional debate mode:
    - BullResearcher — looks for bullish signals
    - BearResearcher — looks for bearish signals
    - NewsAnalyst — analyzes recent news sentiment
    - FundamentalsAnalyst — evaluates PE, PB, EPS, etc.
    - DebateEngine (optional) — Bull and Bear counter each other's arguments over configurable rounds
  4. ResearchManager — synthesizes findings or debate output into a structured `researchThesis`
  5. TradePlanner — converts the thesis into a concrete `traderProposal` with entry logic, why-now, time horizon, invalidation, and sizing intent
  6. Risk Team — two modes:
    - Classic: RiskAnalyst classifies base risk, RiskManager reviews the concrete proposal and emits `riskVerdict`
    - Debate: Aggressive/Conservative/Neutral risk analysts run in parallel, PortfolioManager synthesizes them while also evaluating the `traderProposal` and `researchThesis`
  7. Manager — reads the thesis, proposal, and risk verdict, then produces the final Decision (5-tier action, confidence, stopLoss, takeProfit)

  The shared `TradingReport` now keeps these intermediate decision objects as first-class state so downstream stages do not have
  to reconstruct them from raw findings.

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
       ResearchManager synthesizes debate into a structured ResearchThesis

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

  The PortfolioManager synthesizes all three viewpoints into a balanced risk assessment and proposal-aware risk verdict.

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
  - ResearchThesis — synthesized stance, key drivers, key risks, invalidation conditions, time horizon
  - TraderProposal — concrete trade plan with action bias, entry logic, why-now, and invalidation
  - RiskAssessment — risk level + metrics (VaR, volatility, beta, maxDrawdown)
  - RiskVerdict — approval state, blockers, required adjustments
  - AnalysisArtifact — structured per-stage artifact stored in `analysisArtifacts`
  - Market — 'US' | 'CN' | 'HK'

  Pipeline Configuration

  Defined in src/config/config.ts as PipelineConfig:

  | Option            | Type       | Default | Description                                       |
  |-------------------|------------|---------|---------------------------------------------------|
  | enabledAnalysts   | string[]   | all 4   | Which analysts to run: bull, bear, news, fundamentals |
  | debateEnabled     | boolean    | false   | Enable Bull vs Bear adversarial debate rounds     |
  | maxDebateRounds   | number     | 2       | Number of debate rounds when debate is enabled    |
  | riskDebateEnabled | boolean    | false   | Enable 3-way risk analyst debate + proposal-aware PortfolioManager |
  | outputLanguage    | string     | 'en'    | Output language: 'en', 'zh', 'ja', 'ko', etc.    |
  | ragMode           | RAGMode    | auto    | 'qdrant', 'memory', or 'disabled'                |

  Use buildOrchestrator() from src/orchestrator/OrchestratorFactory.ts to wire everything together
  based on a PipelineConfig.

  LLM Configuration

  src/config/config.ts maps agent names to LLM providers:

       ┌──────────────────┬──────────┬───────────────────┬──────────────────────────────────────────────┐
       │   Agent Group    │ Provider │       Model       │                  Rationale                   │
       ├──────────────────┼──────────┼───────────────────┼──────────────────────────────────────────────┤
       │ Research team    │ SiliconFlow │ DeepSeek-V3    │ Fast, cost-effective for evidence gathering  │
       ├──────────────────┼──────────┼───────────────────┼──────────────────────────────────────────────┤
       │ Trade + Risk + Manager │ SiliconFlow │ DeepSeek-V3 │ Higher-quality synthesis for planning and decisions │
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
  - memory mode: local BM25 keyword search for offline/local RAG (enabled by OLLAMA_HOST or RAG_BM25=true)
  - disabled: no RAG, agents work without context retrieval

  Local Memory System: a pure TypeScript BM25 implementation (src/rag/BM25Index.ts) provides keyword-based
  document retrieval without embeddings or API calls. BM25VectorStore is the local/offline retrieval backend.

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
  - AnalysisRun — one live analysis execution with status, final action/confidence, and a structured snapshot
  - AnalysisStage — per-stage persisted artifacts (`research`, `trade`, `risk`, `final`) linked to an `AnalysisRun`

  Markdown Reports

  Every CLI command automatically saves a markdown report to the reports/ directory:

  | Command           | Report File                              | Contents                                  |
  |-------------------|------------------------------------------|-------------------------------------------|
  | run:analyze       | reports/AAPL_US_2026-04-05_1030.md       | Decision, thesis, trader proposal, risk verdict, indicators |
  | trader:train      | reports/training_AAPL_US_2026-04-05.md   | Pass scores, win rates, lesson counts     |
  | advisor           | reports/advisor_2026-04-05_1030.md        | Market overview, recommendations, summary |

  Reports are git-ignored. The reports/ directory is created automatically on first run.

  Live Analysis Output

  `npm run run:analyze -- <TICKER> [MARKET]` now exposes the staged decision flow in three places:
  - Console output: `Research Thesis`, `Trader Proposal`, and `Risk Verdict` summaries appear before the final decision block
  - Markdown report: dedicated sections for `Research Thesis`, `Trader Proposal`, and `Risk Verdict`
  - Postgres: when `DATABASE_URL` is set, the run is persisted as an `AnalysisRun` plus `AnalysisStage` rows, including partial state when a run fails after earlier stages completed

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
        │ npm run advisor                                          │ Run advisor once for the DB watchlist   │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run advisor -- AAPL,TSLA US                          │ Run advisor once for explicit tickers   │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run advisor:schedule                                 │ Start advisor cron scheduler            │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run db:sync -- --ticker AAPL US                      │ Sync one ticker into Postgres           │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run scheduler:start                                  │ Start cron-based auto-sync              │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run test                                             │ Run all tests                           │
        ├──────────────────────────────────────────────────────────┼─────────────────────────────────────────┤
        │ npm run typecheck                                        │ TypeScript type check                   │
        └──────────────────────────────────────────────────────────┴─────────────────────────────────────────┘

  Environment Variables

  # Required for production analysis
  SILICONFLOW_API_KEY=...       # Research + risk + manager agents

  # Optional — data sources
  DATABASE_URL=...              # PostgreSQL cache + live AnalysisRun/AnalysisStage persistence
  FINNHUB_API_KEY=...           # Finnhub market data

  # Optional — RAG (pick one)
  QDRANT_URL=... + OPENAI_API_KEY=...   # Full RAG mode (Qdrant + OpenAI embeddings)
  OLLAMA_HOST=http://localhost:11434    # Local/offline RAG mode (BM25 keyword search)
  RAG_BM25=true                         # Explicitly force local/offline BM25 mode

  # Optional — alternative LLMs
  ANTHROPIC_API_KEY=...
  GEMINI_API_KEY=...

  # Optional — output language
  OUTPUT_LANGUAGE=en            # en, zh, zh-TW, ja, ko

  Quick Start

  # 1. Start Postgres
  docker compose up -d

  # 2. Set up env
  cp .env.example .env  # fill in SILICONFLOW_API_KEY at minimum

  # 3. Database
  npm run db:generate
  npm run db:migrate

  # 4. Run analysis
  npm run run:analyze -- AAPL US

  # 5. Train trader (optional)
  npm run trader:train -- AAPL US

  Project Structure

     src/
     ├── agents/
     │   ├── base/           IAgent, types (TradingReport, Decision, Finding, ActionTier...)
     │   ├── data/           DataFetcher (stage 1)
     │   ├── analyzer/       TechnicalAnalyzer (stage 2)
     │   ├── researcher/     BaseResearcher, Bull/Bear/News/Fundamentals, DebateEngine, ResearchManager (stages 3-4)
     │   ├── trader/         TradePlanner, TraderAgent, Backtester, CompositeScorer, LessonExtractor, LessonsJournal, ReflectionEngine
     │   ├── risk/           RiskAnalyst, RiskManager, Aggressive/Conservative/Neutral analysts, PortfolioManager (stage 6)
     │   ├── manager/        Manager (stage 7)
     │   ├── advisor/        AdvisorAgent, MarketTrendAnalyzer, AdvisorScheduler
     ├── cli/                Entry points: run, train, sync, watchlist, scheduler, advisor
     ├── analysis/           Setup-aware retrieval helpers and AnalysisRun persistence
     ├── config/             Agent LLM config, PipelineConfig, rate limit config
     ├── data/               Data source implementations (Finnhub, YFinance, Polygon, DateFilteredDataSource, etc.)
     ├── db/                 Prisma client, PostgresDataSource
     ├── evaluation/         Accuracy/Backtest/Reasoning evaluators
     ├── indicators/         Technical indicator calculations (RSI, MACD, Bollinger, etc.)
     ├── llm/                LLM providers (OpenAI, Anthropic, Gemini, Ollama, DeepSeek, SiliconFlow) + registry + normalizeResponse
     ├── orchestrator/       Orchestrator (live decision pipeline with staged report updates) + OrchestratorFactory
     ├── rag/                Retrieval backends (Qdrant, BM25), embedders, chunker
     ├── reports/            Markdown report generators (AnalysisReport, AdvisorReport, TrainerReport)
     ├── sync/               DataSyncService, Scheduler
     ├── messaging/          WhatsApp message sender
     └── utils/              parseJson, logger (Pino), i18n, errors, normalizeOhlcv
     tests/                  automated test suite
     reports/                Generated markdown reports (git-ignored)


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
