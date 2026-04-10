import { DateFilteredDataSource } from '../data/DateFilteredDataSource.js'
import { buildOrchestrator, resolveLLMMap } from '../orchestrator/OrchestratorFactory.js'
import { LLMRegistry } from '../llm/registry.js'
import { DEFAULT_PIPELINE_CONFIG, agentConfig, detectRAGMode } from '../config/config.js'
import { TraderAgent } from '../agents/trader/TraderAgent.js'
import type { Market } from '../agents/base/types.js'
import { createLogger } from '../utils/logger.js'
import { saveTrainerReport } from '../reports/TrainerReport.js'
import { buildDataSourceChain, buildRAGDeps } from './bootstrap.js'
import { saveCalibratedThresholds } from '../config/calibratedThresholdStore.js'

const log = createLogger('cli:train')

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

const fallbackSource = buildDataSourceChain('price-chain')
const { ragMode, vectorStore, embedder } = buildRAGDeps()

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
const llms = resolveLLMMap((agent) => registry.get(agent), 'trader')

function createOrchestrator(cutoffDate: Date) {
  const filteredSource = new DateFilteredDataSource(fallbackSource, cutoffDate)
  return buildOrchestrator({
    llms,
    pipelineConfig: { ...DEFAULT_PIPELINE_CONFIG, ragMode },
    vectorStore,
    embedder,
    dataSource: filteredSource,
    spyDataSource: filteredSource,
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
  const trainResult = await trader.train({
    ticker,
    market,
    maxPasses,
    lookbackMonths,
    evaluationDays: 5,
    earlyStopThreshold: 0.02,
    earlyStopPatience: 2,
  })

  const finalScore = trainResult.passes[trainResult.passes.length - 1]?.avgTestScore ?? 0
  log.info({ finalScore: finalScore.toFixed(3) }, 'Training complete')

  if (trainResult.calibratedThresholds) {
    const thresholdsPath = saveCalibratedThresholds({
      ticker,
      market,
      calibratedThresholds: trainResult.calibratedThresholds,
    })
    log.info(
      {
        path: thresholdsPath,
        sampleSize: trainResult.calibratedThresholds.sampleSize,
        confidence: trainResult.calibratedThresholds.calibrationConfidence,
      },
      'Saved calibrated thresholds for live pipeline',
    )
  }

  // Save markdown report
  const reportPath = saveTrainerReport({
    ticker,
    market,
    maxPasses,
    lookbackMonths,
    evaluationDays: 5,
    results: trainResult.passes,
  })
  log.info({ path: reportPath }, 'Training report saved')
} catch (error) {
  log.error({ error: (error as Error).message }, 'Training failed')
  process.exit(1)
}
