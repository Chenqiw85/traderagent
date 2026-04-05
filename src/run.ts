// src/run.ts — entry point for running a single stock analysis
// Usage: npx tsx src/run.ts AAPL US

import { Orchestrator } from './orchestrator/Orchestrator.js'
import { DataFetcher } from './agents/data/DataFetcher.js'
import { TechnicalAnalyzer } from './agents/analyzer/TechnicalAnalyzer.js'
import { BullResearcher } from './agents/researcher/BullResearcher.js'
import { BearResearcher } from './agents/researcher/BearResearcher.js'
import { NewsAnalyst } from './agents/researcher/NewsAnalyst.js'
import { FundamentalsAnalyst } from './agents/researcher/FundamentalsAnalyst.js'
import { RiskAnalyst } from './agents/risk/RiskAnalyst.js'
import { RiskManager } from './agents/risk/RiskManager.js'
import { Manager } from './agents/manager/Manager.js'
import { LLMRegistry } from './llm/registry.js'
import { TokenProfiler } from './llm/TokenProfiler.js'
import { RetryLLMProvider } from './llm/withRetry.js'
import { FinnhubSource } from './data/finnhub.js'
import { YFinanceSource } from './data/yfinance.js'
import { FallbackDataSource } from './data/FallbackDataSource.js'
import { RateLimitedDataSource } from './data/RateLimitedDataSource.js'
import { rateLimitDefaults } from './config/rateLimits.js'
import { PostgresDataSource } from './db/PostgresDataSource.js'
import { QdrantVectorStore } from './rag/qdrant.js'
import { InMemoryVectorStore } from './rag/InMemoryVectorStore.js'
import { Embedder } from './rag/embedder.js'
import { OllamaEmbedder } from './rag/OllamaEmbedder.js'
import { agentConfig, detectRAGMode, getEmbeddingDimension } from './config/config.js'
import type { Market } from './agents/base/types.js'
import type { IDataSource } from './data/IDataSource.js'
import { getErrorMessage } from './utils/errors.js'
import { createLogger } from './utils/logger.js'

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

// --- Data source fallback chain ---
const dataSources: IDataSource[] = []

// Try Postgres first (local DB cache — no rate limiting needed)
if (process.env['DATABASE_URL']) {
  dataSources.push(new PostgresDataSource())
}

// API fallbacks — wrap with rate limiter
if (process.env['FINNHUB_API_KEY']) {
  dataSources.push(new RateLimitedDataSource(new FinnhubSource(), rateLimitDefaults['finnhub']))
}
dataSources.push(new RateLimitedDataSource(new YFinanceSource(), rateLimitDefaults['yfinance']))

const fallbackSource = new FallbackDataSource('price-chain', dataSources)

// --- RAG mode auto-detection ---
const ragMode = detectRAGMode()
import type { IVectorStore } from './rag/IVectorStore.js'
import type { IEmbedder } from './rag/IEmbedder.js'

let vectorStore: IVectorStore | undefined
let embedder: IEmbedder | undefined

if (ragMode === 'qdrant') {
  const qdrantUrl = process.env['QDRANT_URL']
  const openaiKey = process.env['OPENAI_API_KEY']
  if (!qdrantUrl || !openaiKey) {
    throw new Error('QDRANT_URL and OPENAI_API_KEY are required for qdrant RAG mode')
  }
  const embeddingModel = 'text-embedding-3-small'
  log.info('RAG: Qdrant + OpenAI embeddings')
  vectorStore = new QdrantVectorStore({
    url: qdrantUrl,
    apiKey: process.env['QDRANT_API_KEY'],
    collectionName: 'traderagent',
    vectorSize: getEmbeddingDimension(embeddingModel),
  })
  embedder = new Embedder({ apiKey: openaiKey, model: embeddingModel })
} else if (ragMode === 'memory') {
  log.info('RAG: in-memory + Ollama embeddings')
  vectorStore = new InMemoryVectorStore()
  embedder = new OllamaEmbedder({ model: 'nomic-embed-text' })
} else {
  log.info('RAG: disabled — set OPENAI_API_KEY+QDRANT_URL or OLLAMA_HOST to enable')
}

// --- Build pipeline ---
const registry = new LLMRegistry(agentConfig)

const researcherConfig = { vectorStore, embedder }

// Wrap each LLM provider with TokenProfiler to log per-call token usage
const wrap = (agent: string) => new TokenProfiler(new RetryLLMProvider(registry.get(agent)), agent)

const orchestrator = new Orchestrator({
  dataFetcher: new DataFetcher({
    dataSources: [fallbackSource],
    vectorStore,
    embedder,
  }),
  technicalAnalyzer: new TechnicalAnalyzer({ dataSource: fallbackSource }),
  researcherTeam: [
    new BullResearcher({ llm: wrap('bullResearcher'), ...researcherConfig }),
    new BearResearcher({ llm: wrap('bearResearcher'), ...researcherConfig }),
    new NewsAnalyst({ llm: wrap('newsAnalyst'), ...researcherConfig }),
    new FundamentalsAnalyst({ llm: wrap('fundamentalsAnalyst'), ...researcherConfig }),
  ],
  riskTeam: [
    new RiskAnalyst({ llm: wrap('riskAnalyst') }),
    new RiskManager({ llm: wrap('riskManager') }),
  ],
  manager: new Manager({ llm: wrap('manager'), vectorStore, embedder }),
})

try {
  const report = await orchestrator.run(ticker, resolvedMarket)

  const separator = '='.repeat(60)
  const lines = [`\n${separator}`, `FINAL DECISION: ${report.ticker} (${report.market})`, separator]

  if (report.finalDecision) {
    const d = report.finalDecision
    lines.push(`Action:      ${d.action}`)
    lines.push(`Confidence:  ${(d.confidence * 100).toFixed(0)}%`)
    lines.push(`Reasoning:   ${d.reasoning}`)
    if (d.suggestedPositionSize != null)
      lines.push(`Position:    ${(d.suggestedPositionSize * 100).toFixed(1)}% of portfolio`)
    if (d.stopLoss != null) lines.push(`Stop loss:   $${d.stopLoss}`)
    if (d.takeProfit != null) lines.push(`Take profit: $${d.takeProfit}`)
  } else {
    lines.push('No decision produced.')
  }

  if (report.computedIndicators) {
    const ci = report.computedIndicators
    lines.push('\nComputed Indicators:')
    lines.push(`  RSI: ${ci.momentum.rsi.toFixed(1)} | MACD: ${ci.trend.macd.line.toFixed(2)} | Beta: ${ci.risk.beta.toFixed(2)}`)
    lines.push(`  Volatility: ${(ci.volatility.historicalVolatility * 100).toFixed(1)}% | MaxDD: ${(ci.risk.maxDrawdown * 100).toFixed(1)}% | VaR95: ${(ci.risk.var95 * 100).toFixed(2)}%`)
  }

  lines.push('\nResearch findings:')
  for (const f of report.researchFindings) {
    lines.push(`  [${f.agentName}] ${f.stance} (${(f.confidence * 100).toFixed(0)}%) — ${f.evidence.slice(0, 2).join('; ')}`)
  }

  if (report.riskAssessment) {
    const ra = report.riskAssessment
    lines.push(`\nRisk: ${ra.riskLevel} | VaR: ${(ra.metrics.VaR * 100).toFixed(2)}% | Volatility: ${(ra.metrics.volatility * 100).toFixed(1)}%`)
  }

  log.info(lines.join('\n'))

  TokenProfiler.printSummary()
} catch (err) {
  TokenProfiler.printSummary()
  log.error({ error: getErrorMessage(err) }, 'Pipeline failed')
  process.exit(1)
}
