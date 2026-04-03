// src/cli/advisor.ts — CLI entry point for Advisor agent
// Usage:
//   npm run advisor -- AAPL,TSLA US          # run once for specific tickers
//   npm run advisor:schedule                  # start cron scheduler

import { AdvisorAgent } from '../agents/advisor/AdvisorAgent.js'
import { AdvisorScheduler } from '../agents/advisor/AdvisorScheduler.js'
import { DEFAULT_INDICES } from '../agents/advisor/types.js'
import { formatAdvisorReport } from '../agents/advisor/ReportFormatter.js'
import { Orchestrator } from '../orchestrator/Orchestrator.js'
import { DataFetcher } from '../agents/data/DataFetcher.js'
import { TechnicalAnalyzer } from '../agents/analyzer/TechnicalAnalyzer.js'
import { BullResearcher } from '../agents/researcher/BullResearcher.js'
import { BearResearcher } from '../agents/researcher/BearResearcher.js'
import { NewsAnalyst } from '../agents/researcher/NewsAnalyst.js'
import { FundamentalsAnalyst } from '../agents/researcher/FundamentalsAnalyst.js'
import { RiskAnalyst } from '../agents/risk/RiskAnalyst.js'
import { RiskManager } from '../agents/risk/RiskManager.js'
import { Manager } from '../agents/manager/Manager.js'
import { LLMRegistry } from '../llm/registry.js'
import { TokenProfiler } from '../llm/TokenProfiler.js'
import { FinnhubSource } from '../data/finnhub.js'
import { YFinanceSource } from '../data/yfinance.js'
import { FallbackDataSource } from '../data/FallbackDataSource.js'
import { RateLimitedDataSource } from '../data/RateLimitedDataSource.js'
import { rateLimitDefaults } from '../config/rateLimits.js'
import { PostgresDataSource } from '../db/PostgresDataSource.js'
import { QdrantVectorStore } from '../rag/qdrant.js'
import { InMemoryVectorStore } from '../rag/InMemoryVectorStore.js'
import { Embedder } from '../rag/embedder.js'
import { OllamaEmbedder } from '../rag/OllamaEmbedder.js'
import { agentConfig, detectRAGMode } from '../config/config.js'
import { createTwilioSenderFromEnv } from '../messaging/TwilioWhatsAppSender.js'
import { listTickers } from '../sync/watchlist.js'
import type { IDataSource } from '../data/IDataSource.js'
import type { IVectorStore } from '../rag/IVectorStore.js'
import type { IEmbedder } from '../rag/IEmbedder.js'
import type { Market } from '../agents/base/types.js'
import type { WatchlistEntry, IndexDef } from '../agents/advisor/types.js'

// --- Parse CLI args ---
const mode = process.argv[2]
const isSchedule = mode === 'schedule'

// --- Data source setup (same as run.ts) ---
const dataSources: IDataSource[] = []
if (process.env['DATABASE_URL']) dataSources.push(new PostgresDataSource())
if (process.env['FINNHUB_API_KEY']) dataSources.push(new RateLimitedDataSource(new FinnhubSource(), rateLimitDefaults['finnhub']))
dataSources.push(new RateLimitedDataSource(new YFinanceSource(), rateLimitDefaults['yfinance']))
const fallbackSource = new FallbackDataSource('advisor-chain', dataSources)

// --- RAG setup ---
const ragMode = detectRAGMode()
let vectorStore: IVectorStore | undefined
let embedder: IEmbedder | undefined

if (ragMode === 'qdrant') {
  vectorStore = new QdrantVectorStore({ url: process.env['QDRANT_URL']!, collectionName: 'traderagent', vectorSize: 1536 })
  embedder = new Embedder({ apiKey: process.env['OPENAI_API_KEY']! })
} else if (ragMode === 'memory') {
  vectorStore = new InMemoryVectorStore()
  embedder = new OllamaEmbedder({ model: 'nomic-embed-text' })
}

// --- LLM registry ---
const registry = new LLMRegistry(agentConfig)
const wrap = (agent: string) => new TokenProfiler(registry.get(agent), agent)
const researcherConfig = { vectorStore, embedder }

// --- Build Orchestrator (same pipeline as run.ts) ---
const orchestrator = new Orchestrator({
  dataFetcher: new DataFetcher({ dataSources: [fallbackSource], vectorStore, embedder }),
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

// --- Parse indices from env or use defaults ---
function parseIndices(): readonly IndexDef[] {
  const envIndices = process.env['ADVISOR_INDICES']
  if (!envIndices) return DEFAULT_INDICES

  return envIndices.split(',').map((ticker) => {
    const trimmed = ticker.trim()
    const match = DEFAULT_INDICES.find((d) => d.ticker === trimmed)
    return match ?? { ticker: trimmed, name: trimmed, market: 'US' as Market }
  })
}

// --- WhatsApp sender (optional) ---
let messageSender
try {
  messageSender = createTwilioSenderFromEnv()
} catch {
  console.log('[Advisor] Twilio not configured — reports will print to console only')
}

const whatsappTo = process.env['ADVISOR_WHATSAPP_TO']

// --- Build AdvisorAgent ---
const advisor = new AdvisorAgent({
  llm: wrap('advisor'),
  trendLlm: wrap('marketTrendAnalyzer'),
  dataSource: fallbackSource,
  orchestrator,
  messageSender,
  whatsappTo,
  indices: parseIndices(),
})

// --- Execute ---
if (isSchedule) {
  // Schedule mode: run on cron
  const scheduler = new AdvisorScheduler({
    advisor,
    getWatchlist: async () => {
      const tickers = await listTickers()
      return tickers.map((t) => ({ ticker: t.ticker, market: t.market as Market }))
    },
  })
  scheduler.start()
  console.log('[Advisor] Scheduler running. Press Ctrl+C to stop.')
} else {
  // One-shot mode: run immediately
  const getWatchlist = async (): Promise<WatchlistEntry[]> => {
    // If tickers provided via CLI args
    const tickerArg = process.argv[2]
    const marketArg = (process.argv[3] as Market) ?? 'US'
    if (tickerArg && tickerArg !== 'schedule') {
      return tickerArg.split(',').map((t) => ({ ticker: t.trim(), market: marketArg }))
    }
    // Otherwise read from DB watchlist
    const tickers = await listTickers()
    if (tickers.length === 0) {
      console.error('No tickers provided. Usage: npm run advisor -- AAPL,TSLA US')
      console.error('Or add tickers to watchlist: npm run watchlist:add -- AAPL US')
      process.exit(1)
    }
    return tickers.map((t) => ({ ticker: t.ticker, market: t.market as Market }))
  }

  try {
    const watchlist = await getWatchlist()
    console.log(`\n[Advisor] Analyzing: ${watchlist.map((w) => w.ticker).join(', ')}\n`)

    const report = await advisor.run(watchlist)

    // Print to console
    console.log('\n' + '='.repeat(60))
    console.log(formatAdvisorReport(report))
    console.log('='.repeat(60))

    TokenProfiler.printSummary()
  } catch (err) {
    TokenProfiler.printSummary()
    console.error(`\n[Advisor] FAILED: ${(err as Error).message}`)
    process.exit(1)
  }
}
