// src/cli/advisor.ts — CLI entry point for Advisor agent
// Usage:
//   npm run advisor -- AAPL,TSLA US          # run once for specific tickers
//   npm run advisor:schedule                  # start cron scheduler

import { AdvisorAgent } from '../agents/advisor/AdvisorAgent.js'
import { AdvisorScheduler } from '../agents/advisor/AdvisorScheduler.js'
import { BaselineAnalysisService } from '../agents/advisor/BaselineAnalysisService.js'
import { FreshMarketOverlayBuilder } from '../agents/advisor/FreshMarketOverlayBuilder.js'
import { MarketTrendAnalyzer } from '../agents/advisor/MarketTrendAnalyzer.js'
import { NextDayForecastSynthesizer } from '../agents/advisor/NextDayForecastSynthesizer.js'
import { ReportLoader, type ReportLoaderDeps } from '../agents/advisor/ReportLoader.js'
import { TechnicalAnalyzer } from '../agents/analyzer/TechnicalAnalyzer.js'
import { DEFAULT_INDICES } from '../agents/advisor/types.js'
import { formatAdvisorReport } from '../agents/advisor/ReportFormatter.js'
import { FullAnalysisRunner } from '../analysis/FullAnalysisRunner.js'
import { DEFAULT_PIPELINE_CONFIG, agentConfig } from '../config/config.js'
import { LLMRegistry } from '../llm/registry.js'
import { TokenProfiler } from '../llm/TokenProfiler.js'
import { RetryLLMProvider } from '../llm/withRetry.js'
import { ConcurrencyLimiter } from '../llm/ConcurrencyLimiter.js'
import { createWhatsAppSenderFromEnv } from '../messaging/WhatsAppWebSender.js'
import { buildOrchestrator, resolveLLMMap } from '../orchestrator/OrchestratorFactory.js'
import { listTickers } from '../sync/watchlist.js'
import type { Market } from '../agents/base/types.js'
import type { AdvisorForecastRepository } from '../agents/advisor/AdvisorForecastRepository.js'
import type { TickerAccuracyProvider } from '../agents/advisor/TickerAccuracyProvider.js'
import type { WatchlistEntry, IndexDef } from '../agents/advisor/types.js'
import type { AnalysisRunRepository } from '../analysis/AnalysisRunRepository.js'
import { validateTicker, validateMarket } from '../utils/validation.js'
import { getErrorMessage } from '../utils/errors.js'
import { createLogger } from '../utils/logger.js'
import { saveAdvisorReport } from '../reports/AdvisorMarkdownReport.js'
import { parseAdvisorCliArgs } from './advisorArgs.js'
import { buildDataSourceChain, buildLiveMarketSourceChain, buildRAGDeps } from './bootstrap.js'
import { loadCalibratedThresholds } from '../config/calibratedThresholdStore.js'

const log = createLogger('cli:advisor')

// --- Parse CLI args ---
const parsedArgs = parseAdvisorCliArgs(process.argv.slice(2))
const isSchedule = parsedArgs.isSchedule
const isDryRun = parsedArgs.isDryRun

const fallbackSource = buildDataSourceChain('advisor-chain')
const liveMarketSource = buildLiveMarketSourceChain('advisor-live-market-chain')
const { ragMode, vectorStore, embedder } = buildRAGDeps()

// --- LLM registry ---
const registry = new LLMRegistry(agentConfig)
const maxConcurrent = Number(process.env['LLM_MAX_CONCURRENT'] ?? '2')
const wrap = (agent: string) =>
  new TokenProfiler(new RetryLLMProvider(new ConcurrencyLimiter(registry.get(agent), maxConcurrent)), agent)
const llms = resolveLLMMap(wrap, 'default')
const orchestrator = buildOrchestrator({
  llms,
  pipelineConfig: { ...DEFAULT_PIPELINE_CONFIG, ragMode },
  vectorStore,
  embedder,
  dataSource: fallbackSource,
  spyDataSource: fallbackSource,
  calibratedThresholdsLoader: loadCalibratedThresholds,
})
let analysisRunRepository: AnalysisRunRepository | undefined
let reportLoaderDb: ReportLoaderDeps | undefined
let forecastRepository: AdvisorForecastRepository | undefined
let accuracyProvider: TickerAccuracyProvider | undefined

if (process.env['DATABASE_URL']) {
  const [
    { AnalysisRunRepository },
    { prisma },
    { AdvisorForecastRepository },
    { TickerAccuracyProvider },
  ] = await Promise.all([
    import('../analysis/AnalysisRunRepository.js'),
    import('../db/client.js'),
    import('../agents/advisor/AdvisorForecastRepository.js'),
    import('../agents/advisor/TickerAccuracyProvider.js'),
  ])

  analysisRunRepository = new AnalysisRunRepository()
  reportLoaderDb = {
    db: prisma as unknown as ReportLoaderDeps['db'],
  }
  forecastRepository = new AdvisorForecastRepository()
  accuracyProvider = new TickerAccuracyProvider({ repository: forecastRepository })
}

const fullAnalysisRunner = new FullAnalysisRunner({
  orchestrator,
  analysisRunRepository,
})
const reportLoader = new ReportLoader(reportLoaderDb ?? {})

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

// --- WhatsApp sender (optional, skipped in dry-run) ---
let messageSender
if (isDryRun) {
  log.info('Dry-run mode — WhatsApp disabled')
} else {
  try {
    const sender = createWhatsAppSenderFromEnv()
    await sender.connect()
    messageSender = sender
  } catch {
    log.info('WhatsApp not configured — reports will print to log only')
  }
}

const whatsappTo = process.env['ADVISOR_WHATSAPP_TO']

// --- Build AdvisorAgent ---
const advisor = new AdvisorAgent({
  llm: wrap('advisor'),
  trendAnalyzer: new MarketTrendAnalyzer({
    llm: wrap('marketTrendAnalyzer'),
    dataSource: fallbackSource,
  }),
  baselineService: new BaselineAnalysisService({
    reportLoader,
    fullAnalysisRunner,
  }),
  overlayBuilder: new FreshMarketOverlayBuilder({
    dataSource: fallbackSource,
    liveMarketDataSource: liveMarketSource,
    technicalAnalyzer: new TechnicalAnalyzer({ dataSource: fallbackSource }),
  }),
  forecastSynthesizer: new NextDayForecastSynthesizer({
    llm: wrap('advisorForecastAnalyzer'),
    accuracyProvider,
  }),
  messageSender,
  whatsappTo,
  indices: parseIndices(),
  ragMode,
  forecastRepository,
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
  log.info('Scheduler running. Press Ctrl+C to stop.')
} else {
  // One-shot mode: run immediately
  const getWatchlist = async (): Promise<WatchlistEntry[]> => {
    // If tickers provided via CLI args
    const tickerArg = parsedArgs.tickerArg
    const marketArg = parsedArgs.marketArg ?? 'US'
    if (tickerArg) {
      const market = validateMarket(marketArg)
      return tickerArg.split(',').map((t) => ({ ticker: validateTicker(t), market }))
    }
    // Otherwise read from DB watchlist
    const tickers = await listTickers()
    if (tickers.length === 0) {
      log.error('No tickers provided. Usage: npm run advisor -- AAPL,TSLA US')
      log.error('Or add tickers to watchlist: npm run watchlist:add -- AAPL US')
      process.exit(1)
    }
    return tickers.map((t) => ({ ticker: t.ticker, market: t.market as Market }))
  }

  try {
    const watchlist = await getWatchlist()
    log.info({ tickers: watchlist.map((w) => w.ticker) }, 'Analyzing')

    const report = await advisor.run(watchlist)

    const separator = '='.repeat(60)
    log.info(`\n${separator}\n${formatAdvisorReport(report)}\n${separator}`)

    // Save markdown report
    const reportPath = saveAdvisorReport(report)
    log.info({ path: reportPath }, 'Advisor report saved')

    TokenProfiler.printSummary()
  } catch (err) {
    TokenProfiler.printSummary()
    log.error({ error: getErrorMessage(err) }, 'Advisor failed')
    process.exit(1)
  }
}
