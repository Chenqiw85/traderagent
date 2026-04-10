import type { DataType, Market } from '../base/types.js'
import type { FullAnalysisRunner } from '../../analysis/FullAnalysisRunner.js'
import { tradingDaysBetween } from './tradingCalendar.js'
import { ReportLoader } from './ReportLoader.js'
import type { BaselineAnalysis } from './types.js'
import { normalizeOhlcv } from '../../utils/normalizeOhlcv.js'

const DB_BASELINE_OHLCV_MAX_STALENESS_HOURS = 96
const DB_BASELINE_ALIGNMENT_MAX_HOURS = 36

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

function extractLatestDataDate(
  report: BaselineAnalysis['report'],
  type: DataType,
): Date | null {
  const raw = report.rawData.find((entry) => entry.type === type)
  if (!raw) return null

  // For OHLCV data, prefer the latest bar date from the series
  if (type === 'ohlcv') {
    const bars = normalizeOhlcv(raw.data)
    const latest = bars.at(-1)
    if (latest?.date) {
      const parsed = parseDateValue(latest.date)
      if (parsed) return parsed
    }
  }

  // For non-OHLCV data (technicals, news, fundamentals), use fetchedAt
  return parseDateValue(raw.fetchedAt)
}

function hasInvalidDbMarketContext(loaded: BaselineAnalysis, asOf: Date): boolean {
  if (loaded.source !== 'db') return false

  const latestOhlcvDate = extractLatestDataDate(loaded.report, 'ohlcv')
  if (latestOhlcvDate) {
    const ohlcvAgeHours = (asOf.getTime() - latestOhlcvDate.getTime()) / (1000 * 60 * 60)
    if (ohlcvAgeHours > DB_BASELINE_OHLCV_MAX_STALENESS_HOURS) {
      return true
    }
  }

  const latestTechnicalsDate = extractLatestDataDate(loaded.report, 'technicals')
  if (latestOhlcvDate && latestTechnicalsDate) {
    const alignmentGapHours = Math.abs(latestTechnicalsDate.getTime() - latestOhlcvDate.getTime()) / (1000 * 60 * 60)
    if (alignmentGapHours > DB_BASELINE_ALIGNMENT_MAX_HOURS) {
      return true
    }
  }

  return false
}

type LoadBaselineInput = {
  ticker: string
  market: Market
  asOf: Date
  ragMode?: string
}

function hasUsableBaseline(loaded: BaselineAnalysis): boolean {
  return loaded.report.finalDecision != null
}

export class BaselineAnalysisService {
  constructor(
    private readonly deps: {
      reportLoader: Pick<ReportLoader, 'loadLatest'>
      fullAnalysisRunner: Pick<FullAnalysisRunner, 'runTicker'>
    },
  ) {}

  async loadBaseline(input: LoadBaselineInput): Promise<BaselineAnalysis> {
    const loaded = await this.deps.reportLoader.loadLatest(input.ticker, input.market)

    if (!loaded || !hasUsableBaseline(loaded)) {
      const fresh = await this.deps.fullAnalysisRunner.runTicker(input)
      return { report: fresh, asOf: input.asOf, source: 'fresh-run' }
    }

    const stale = tradingDaysBetween(loaded.asOf, input.asOf) > 3
      || hasInvalidDbMarketContext(loaded, input.asOf)
    if (!stale) {
      return loaded
    }

    const fresh = await this.deps.fullAnalysisRunner.runTicker(input)
    return { report: fresh, asOf: input.asOf, source: 'fresh-run' }
  }
}
