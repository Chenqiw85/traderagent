import type { IDataSource } from '../../data/IDataSource.js'
import type { ILiveMarketDataSource } from '../../data/ILiveMarketDataSource.js'
import type { LiveMarketSnapshot, Market, TradingReport, DataResult } from '../base/types.js'
import type { TechnicalAnalyzer } from '../analyzer/TechnicalAnalyzer.js'
import { normalizeOhlcv } from '../../utils/normalizeOhlcv.js'
import { resolveEffectiveLivePrice } from '../../utils/liveMarketSnapshot.js'
import type { FreshMarketOverlay } from './types.js'

type BuildOverlayInput = {
  ticker: string
  market: Market
  asOf: Date
}

type FreshMarketOverlayBuilderDeps = {
  dataSource: IDataSource
  liveMarketDataSource: ILiveMarketDataSource
  technicalAnalyzer: Pick<TechnicalAnalyzer, 'run'>
}

type LiveAnchorSession = 'postmarket' | 'premarket' | 'regular' | 'unknown'

const LIVE_ANCHOR_MAX_AGE_MS = 6 * 60 * 60 * 1000
const MARKET_TIME_ZONES: Record<Market, string> = {
  US: 'America/New_York',
  CN: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
}

function parseBarDate(value: string | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toMarketSessionKey(date: Date, market: Market): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIME_ZONES[market],
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getLiveAnchorSession(marketState: string | undefined): LiveAnchorSession {
  const normalized = marketState?.toLowerCase() ?? ''
  if (normalized.includes('post')) return 'postmarket'
  if (normalized.includes('pre')) return 'premarket'
  if (normalized.includes('regular') || normalized.includes('open')) return 'regular'
  return 'unknown'
}

function resolveLiveAnchor(snapshot: LiveMarketSnapshot): { price: number; timestamp: Date; session: LiveAnchorSession } | null {
  const session = getLiveAnchorSession(snapshot.marketState)
  const effectivePrice = resolveEffectiveLivePrice(snapshot)

  if (effectivePrice != null) {
    const timestamp = session === 'postmarket'
      ? snapshot.postMarketTime ?? snapshot.fetchedAt
      : session === 'premarket'
        ? snapshot.preMarketTime ?? snapshot.fetchedAt
        : snapshot.regularMarketTime ?? snapshot.fetchedAt
    return { price: effectivePrice, timestamp, session }
  }

  if (isFiniteNumber(snapshot.bid) && isFiniteNumber(snapshot.ask)) {
    return { price: (snapshot.bid + snapshot.ask) / 2, timestamp: snapshot.fetchedAt, session: 'unknown' }
  }

  if (isFiniteNumber(snapshot.bid)) {
    return { price: snapshot.bid, timestamp: snapshot.fetchedAt, session: 'unknown' }
  }

  if (isFiniteNumber(snapshot.ask)) {
    return { price: snapshot.ask, timestamp: snapshot.fetchedAt, session: 'unknown' }
  }

  return null
}

function toNewsItems(data: unknown): string[] {
  if (!Array.isArray(data)) return []

  return data
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const row = item as Record<string, unknown>
      const title = typeof row['title'] === 'string' ? row['title'].trim() : ''
      const description = typeof row['description'] === 'string' ? row['description'].trim() : ''
      return [title, description].filter((value) => value.length > 0).join(' - ')
    })
    .filter((item) => item.length > 0)
}

export class FreshMarketOverlayBuilder {
  constructor(private readonly deps: FreshMarketOverlayBuilderDeps) {}

  async build({ ticker, market, asOf }: BuildOverlayInput): Promise<FreshMarketOverlay> {
    const ohlcvResult = await this.deps.dataSource.fetch({
      ticker,
      market,
      type: 'ohlcv',
      from: new Date(asOf.getTime() - 365 * 86400000),
      to: asOf,
    })

    const bars = normalizeOhlcv(ohlcvResult.data)
    if (bars.length === 0) {
      throw new Error(`FreshMarketOverlayBuilder: insufficient OHLCV bars for ${ticker}`)
    }

    const liveSnapshot = await this.deps.liveMarketDataSource.fetchLiveSnapshot({
      ticker,
      market,
    })
    const liveAnchor = resolveLiveAnchor(liveSnapshot)
    if (!liveAnchor) {
      throw new Error(`FreshMarketOverlayBuilder: missing live market price for ${ticker}`)
    }

    const anchorAgeMs = Math.max(0, asOf.getTime() - liveAnchor.timestamp.getTime())
    if (anchorAgeMs > LIVE_ANCHOR_MAX_AGE_MS) {
      throw new Error(`FreshMarketOverlayBuilder: stale live market price for ${ticker}`)
    }

    const datedBars = bars
      .map((bar, index) => ({ bar, index, date: parseBarDate(bar.date) }))
      .filter((entry): entry is { bar: typeof bars[number]; index: number; date: Date } => entry.date != null)
      .sort((a, b) => a.date.getTime() - b.date.getTime() || a.index - b.index)

    let completedBars = datedBars
    const anchorSessionKey = toMarketSessionKey(liveAnchor.timestamp, market)
    const latestDatedBar = completedBars.at(-1)
    if (
      latestDatedBar
      && liveAnchor.session !== 'postmarket'
      && toMarketSessionKey(latestDatedBar.date, market) === anchorSessionKey
    ) {
      completedBars = completedBars.slice(0, -1)
    }

    const latestCompletedBar = completedBars.at(-1)
    if (!latestCompletedBar) {
      throw new Error(`FreshMarketOverlayBuilder: insufficient completed OHLCV history for ${ticker}`)
    }

    const newsResult = await this.loadNews(ticker, market, asOf)
    const previousClose = latestCompletedBar.bar.close
    const latestClose = liveAnchor.price
    const changePercent = previousClose > 0 ? ((latestClose - previousClose) / previousClose) * 100 : 0
    const technicalBars = completedBars.map(({ bar, date }) => ({
      ...bar,
      date: bar.date ?? date.toISOString(),
    }))

    const technicalReport = await this.deps.technicalAnalyzer.run({
      ticker,
      market,
      timestamp: asOf,
      rawData: [{ ...ohlcvResult, data: technicalBars } as DataResult],
      researchFindings: [],
      analysisArtifacts: [],
    } as TradingReport)

    const indicators = technicalReport.computedIndicators
    if (!indicators) {
      throw new Error(`FreshMarketOverlayBuilder: technical analysis did not return computed indicators for ${ticker}`)
    }

    return {
      asOf,
      latestClose,
      previousClose,
      changePercent,
      indicators,
      newsItems: toNewsItems(newsResult?.data),
    }
  }

  private async loadNews(ticker: string, market: Market, asOf: Date): Promise<DataResult | null> {
    try {
      return await this.deps.dataSource.fetch({
        ticker,
        market,
        type: 'news',
        from: new Date(asOf.getTime() - 2 * 86400000),
        to: asOf,
      })
    } catch {
      return null
    }
  }
}
