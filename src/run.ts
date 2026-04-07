// src/run.ts — entry point for running a single stock analysis
// Usage: npx tsx src/run.ts AAPL US

import { buildOrchestrator, resolveLLMMap } from './orchestrator/OrchestratorFactory.js'
import { LLMRegistry } from './llm/registry.js'
import { TokenProfiler } from './llm/TokenProfiler.js'
import { RetryLLMProvider } from './llm/withRetry.js'
import { DEFAULT_PIPELINE_CONFIG, agentConfig } from './config/config.js'
import type { Market, TradingReport } from './agents/base/types.js'
import type { AnalysisRunRepository } from './analysis/AnalysisRunRepository.js'
import { getErrorMessage } from './utils/errors.js'
import { createLogger } from './utils/logger.js'
import { formatConsoleAnalysisOutput, saveAnalysisReport } from './reports/AnalysisReport.js'
import { buildDataSourceChain, buildRAGDeps } from './cli/bootstrap.js'

const log = createLogger('run')

const VALID_MARKETS = new Set(['US', 'CN', 'HK'])

const ticker = process.argv[2]
const market = process.argv[3] as Market | undefined

if (!ticker || VALID_MARKETS.has(ticker)) {
  log.error(`Usage: npm run run:analyze -- <TICKER> [MARKET]`)
  log.error(`  TICKER  Stock symbol (e.g. AAPL, SNDK)`)
  log.error(`  MARKET  Market: US (default), CN, HK`)
  if (VALID_MARKETS.has(ticker ?? '')) {
    log.error(`Error: "${ticker}" looks like a market, not a ticker.`)
    log.error(`Did you mean: npm run run:analyze -- <TICKER> ${ticker}`)
  }
  process.exit(1)
}

const resolvedMarket: Market = market && VALID_MARKETS.has(market) ? market : 'US'

log.info({ ticker, market: resolvedMarket }, 'Analyzing stock')

const fallbackSource = buildDataSourceChain('price-chain')
const { ragMode, vectorStore, embedder, perAgentMemory } = buildRAGDeps()

if (ragMode === 'qdrant') {
  log.info('RAG: Qdrant + OpenAI embeddings')
} else if (ragMode === 'memory') {
  log.info('RAG: local BM25 keyword search')
} else {
  log.info('RAG: disabled — set OPENAI_API_KEY+QDRANT_URL, OLLAMA_HOST, or RAG_BM25=true to enable')
}

// --- Build pipeline ---
const registry = new LLMRegistry(agentConfig)

// Wrap each LLM provider with TokenProfiler to log per-call token usage
const wrap = (agent: string) => new TokenProfiler(new RetryLLMProvider(registry.get(agent)), agent)
const llms = resolveLLMMap(wrap, 'default')
const orchestrator = buildOrchestrator({
  llms,
  pipelineConfig: { ...DEFAULT_PIPELINE_CONFIG, ragMode },
  vectorStore,
  embedder,
  perAgentMemory,
  dataSource: fallbackSource,
  spyDataSource: fallbackSource,
})

let analysisRunRepository: AnalysisRunRepository | undefined
let analysisRunId: string | undefined
let latestReport: TradingReport | undefined

try {
  const asOf = new Date()
  latestReport = {
    ticker,
    market: resolvedMarket,
    timestamp: asOf,
    rawData: [],
    researchFindings: [],
    analysisArtifacts: [],
  }
  analysisRunRepository = process.env['DATABASE_URL']
    ? new (await import('./analysis/AnalysisRunRepository.js')).AnalysisRunRepository()
    : undefined
  analysisRunId = analysisRunRepository
    ? await analysisRunRepository.startRun({
        ticker,
        market: resolvedMarket,
        asOf,
        ragMode,
      })
    : undefined

  const report = await orchestrator.run(ticker, resolvedMarket, {
    timestamp: asOf,
    onReportUpdate: (partialReport) => {
      latestReport = partialReport
    },
  })
  latestReport = report

  log.info(formatConsoleAnalysisOutput(report))

  // Save markdown report
  const reportPath = saveAnalysisReport(report)
  log.info({ path: reportPath }, 'Markdown report saved')

  if (analysisRunRepository && analysisRunId) {
    await analysisRunRepository.completeRun(analysisRunId, {
      finalAction: report.finalDecision?.action,
      finalConfidence: report.finalDecision?.confidence,
      artifacts: report.analysisArtifacts ?? [],
      snapshot: report,
    })
  }
} catch (err) {
  if (analysisRunRepository && analysisRunId) {
    try {
      await analysisRunRepository.failRun(analysisRunId, {
        artifacts: latestReport?.analysisArtifacts ?? [],
        snapshot: latestReport,
      })
    } catch (failErr) {
      log.error({ error: getErrorMessage(failErr), runId: analysisRunId }, 'Failed to mark analysis run as failed')
    }
  }

  TokenProfiler.printSummary()
  log.error({ error: getErrorMessage(err) }, 'Pipeline failed')
  process.exit(1)
}

TokenProfiler.printSummary()
