import { Orchestrator } from '../orchestrator/Orchestrator.js'
import { DateFilteredDataSource } from '../data/DateFilteredDataSource.js'
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
import { TraderAgent } from '../agents/trader/TraderAgent.js'
import type { Market } from '../agents/base/types.js'
import type { IDataSource } from '../data/IDataSource.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('cli:train')
import type { IVectorStore } from '../rag/IVectorStore.js'
import type { IEmbedder } from '../rag/IEmbedder.js'

const VALID_MARKETS = new Set(['US', 'CN', 'HK'])
const args = process.argv.slice(2)
const ticker = args[0]
const marketArg = args[1]

let maxPasses = 4
let lookbackMonths = 12

for (let index = 2; index < args.length; index++) {
  const arg = args[index]
  if (arg === '--passes' && args[index + 1]) {
    const parsed = Number.parseInt(args[index + 1]!, 10)
    if (!Number.isNaN(parsed) && parsed > 0) maxPasses = parsed
    index += 1
  } else if (arg === '--lookback' && args[index + 1]) {
    const parsed = Number.parseInt(args[index + 1]!, 10)
    if (!Number.isNaN(parsed) && parsed > 0) lookbackMonths = parsed
    index += 1
  }
}

if (!ticker || (marketArg != null && !VALID_MARKETS.has(marketArg))) {
  log.error('Usage: npm run trader:train -- <TICKER> [MARKET] [--passes N] [--lookback MONTHS]')
  log.error('  TICKER     Stock symbol (e.g. AAPL)')
  log.error('  MARKET     US (default), CN, HK')
  log.error('  --passes   Number of training passes (default 4)')
  log.error('  --lookback Months of historical data (default 12)')
  process.exit(1)
}

const market = (marketArg ?? 'US') as Market
log.info({ ticker, market, maxPasses, lookbackMonths }, 'Trader Training')

const dataSources: IDataSource[] = []
if (process.env['DATABASE_URL']) {
  dataSources.push(new PostgresDataSource())
}
if (process.env['FINNHUB_API_KEY']) {
  dataSources.push(new RateLimitedDataSource(new FinnhubSource(), rateLimitDefaults['finnhub']))
}
dataSources.push(new RateLimitedDataSource(new YFinanceSource(), rateLimitDefaults['yfinance']))
const fallbackSource = new FallbackDataSource('price-chain', dataSources)

const ragMode = detectRAGMode()
let vectorStore: IVectorStore | undefined
let embedder: IEmbedder | undefined

if (ragMode === 'qdrant') {
  const qdrantUrl = process.env['QDRANT_URL']
  const openaiKey = process.env['OPENAI_API_KEY']
  if (!qdrantUrl || !openaiKey) {
    log.error('Qdrant RAG mode requires QDRANT_URL and OPENAI_API_KEY')
    process.exit(1)
  }
  vectorStore = new QdrantVectorStore({
    url: qdrantUrl,
    collectionName: 'traderagent',
    vectorSize: 1536,
  })
  embedder = new Embedder({ apiKey: openaiKey })
} else if (ragMode === 'memory') {
  vectorStore = new InMemoryVectorStore()
  embedder = new OllamaEmbedder({ model: 'nomic-embed-text' })
}

const endDate = new Date()
const startDate = new Date()
startDate.setMonth(startDate.getMonth() - lookbackMonths)

log.info({ ticker, lookbackMonths }, 'Fetching OHLCV data')
const ohlcvResult = await fallbackSource.fetch({
  ticker,
  market,
  type: 'ohlcv',
  from: startDate,
  to: endDate,
})

const rawBars = Array.isArray(ohlcvResult.data)
  ? ohlcvResult.data
  : (ohlcvResult.data as { quotes?: unknown[] }).quotes ?? []

type RawBar = Record<string, unknown>
const ohlcvBars = (rawBars as RawBar[])
  .map((bar) => ({
    date: String(bar.date ?? bar.Date ?? ''),
    open: Number(bar.open ?? bar.Open ?? 0),
    high: Number(bar.high ?? bar.High ?? 0),
    low: Number(bar.low ?? bar.Low ?? 0),
    close: Number(bar.close ?? bar.Close ?? bar.adjClose ?? 0),
    volume: Number(bar.volume ?? bar.Volume ?? 0),
  }))
  .filter((bar) => bar.date !== '' && !Number.isNaN(bar.close) && bar.close > 0)

if (ohlcvBars.length < 30) {
  log.error('Not enough OHLCV data for training. Need at least 30 bars.')
  process.exit(1)
}

const registry = new LLMRegistry(agentConfig)
const researcherConfig = { vectorStore, embedder }

function createOrchestrator(cutoffDate: Date): Orchestrator {
  const filteredSource = new DateFilteredDataSource(fallbackSource, cutoffDate)
  return new Orchestrator({
    dataFetcher: new DataFetcher({
      dataSources: [filteredSource],
      vectorStore,
      embedder,
    }),
    technicalAnalyzer: new TechnicalAnalyzer({ dataSource: filteredSource }),
    researcherTeam: [
      new BullResearcher({ llm: registry.get('traderPipelineBull'), ...researcherConfig }),
      new BearResearcher({ llm: registry.get('traderPipelineBear'), ...researcherConfig }),
      new NewsAnalyst({ llm: registry.get('traderPipelineNews'), ...researcherConfig }),
      new FundamentalsAnalyst({
        llm: registry.get('traderPipelineFundamentals'),
        ...researcherConfig,
      }),
    ],
    riskTeam: [
      new RiskAnalyst({ llm: registry.get('traderPipelineRisk') }),
      new RiskManager({ llm: registry.get('traderPipelineRiskMgr') }),
    ],
    manager: new Manager({
      llm: registry.get('traderPipelineManager'),
      vectorStore,
      embedder,
    }),
  })
}

const trader = new TraderAgent({
  orchestratorFactory: createOrchestrator,
  lessonLLM: registry.get('traderLessonExtractor'),
  vectorStore,
  embedder,
  ohlcvBars,
})

try {
  const results = await trader.train({
    ticker,
    market,
    maxPasses,
    lookbackMonths,
    evaluationDays: 5,
    earlyStopThreshold: 0.02,
    earlyStopPatience: 2,
  })

  const finalScore = results[results.length - 1]?.avgTestScore ?? 0
  log.info({ finalScore: finalScore.toFixed(3) }, 'Training complete')
} catch (error) {
  log.error({ error: (error as Error).message }, 'Training failed')
  process.exit(1)
}
