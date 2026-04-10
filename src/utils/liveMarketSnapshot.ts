import type { LiveMarketSnapshot, TradingReport } from '../agents/base/types.js'
import { normalizeOhlcv } from './normalizeOhlcv.js'

type LiveSession = 'postmarket' | 'premarket' | 'regular' | 'unknown'

function normalizeCurrencyCode(currency?: string): string | undefined {
  const normalized = currency?.trim().toUpperCase()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function formatMoney(value: number, currency?: string): string {
  const code = normalizeCurrencyCode(currency) ?? 'USD'

  if (code === 'USD') {
    return `$${value.toFixed(2)}`
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'symbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${code} ${value.toFixed(2)}`
  }
}

function formatSignedMoney(value: number, currency?: string): string {
  return `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value), currency)}`
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(2)}%`
}

function getSessionLabel(snapshot: LiveMarketSnapshot): LiveSession {
  const marketState = snapshot.marketState?.toLowerCase() ?? ''

  if (marketState.includes('post')) return 'postmarket'
  if (marketState.includes('pre')) return 'premarket'
  if (marketState.includes('regular') || marketState.includes('open')) return 'regular'
  return marketState.length > 0 ? 'unknown' : 'unknown'
}

function getEffectivePriceSession(snapshot: LiveMarketSnapshot): LiveSession {
  const marketState = snapshot.marketState?.toLowerCase() ?? ''

  if (marketState.includes('post') && snapshot.postMarketPrice != null) return 'postmarket'
  if (marketState.includes('pre') && snapshot.preMarketPrice != null) return 'premarket'
  if (snapshot.regularMarketPrice != null) return 'regular'
  return 'unknown'
}

function extractLatestClose(report: TradingReport): number | undefined {
  const ohlcvResult = report.rawData.find((entry) => entry.type === 'ohlcv')
  if (!ohlcvResult) return undefined

  const bars = normalizeOhlcv(ohlcvResult.data)
  if (bars.length === 0) return undefined

  const datedBars = bars
    .map((bar, index) => ({
      bar,
      index,
      time: bar.date ? new Date(bar.date).getTime() : Number.NaN,
    }))
    .filter((entry) => Number.isFinite(entry.time))

  if (datedBars.length > 0) {
    datedBars.sort((a, b) => a.time - b.time || a.index - b.index)
    return datedBars[datedBars.length - 1]?.bar.close
  }

  return bars.at(-1)?.close
}

function resolveMarketStateLabel(snapshot: LiveMarketSnapshot): string {
  const session = getSessionLabel(snapshot)
  if (session !== 'unknown') return session

  return snapshot.marketState?.toLowerCase() ?? 'unknown'
}

export function resolveEffectiveLivePrice(snapshot: LiveMarketSnapshot): number | undefined {
  const marketState = snapshot.marketState?.toLowerCase() ?? ''

  if (marketState.includes('post') && snapshot.postMarketPrice != null) {
    return snapshot.postMarketPrice
  }

  if (marketState.includes('pre') && snapshot.preMarketPrice != null) {
    return snapshot.preMarketPrice
  }

  if (snapshot.regularMarketPrice != null) {
    return snapshot.regularMarketPrice
  }

  return undefined
}

export function formatLiveMarketContextLines(report: TradingReport): string[] {
  const snapshot = report.liveMarketSnapshot
  if (!snapshot) {
    return []
  }

  const lines: string[] = ['Live market snapshot']
  const session = getEffectivePriceSession(snapshot)
  const effectivePrice = resolveEffectiveLivePrice(snapshot)
  const latestClose = extractLatestClose(report)

  lines.push(`Session: ${session}`)

  if (effectivePrice != null) {
    lines.push(`Effective live price: ${formatMoney(effectivePrice, snapshot.currency)}`)
  }

  if (latestClose != null) {
    lines.push(`Latest daily close: ${formatMoney(latestClose, snapshot.currency)}`)
  }

  if (effectivePrice != null && latestClose != null) {
    const delta = effectivePrice - latestClose
    const deltaPercent = latestClose > 0 ? (delta / latestClose) * 100 : 0
    lines.push(`Delta vs close: ${formatSignedMoney(delta, snapshot.currency)} (${formatSignedPercent(deltaPercent)})`)
  }

  if (snapshot.bid != null && snapshot.ask != null) {
    lines.push(`Bid/Ask: ${formatMoney(snapshot.bid, snapshot.currency)} / ${formatMoney(snapshot.ask, snapshot.currency)}`)
  }

  return lines
}

export function formatLiveMarketReportLines(snapshot: LiveMarketSnapshot): string[] {
  const lines: string[] = []
  const marketState = resolveMarketStateLabel(snapshot)
  const effectivePrice = resolveEffectiveLivePrice(snapshot)

  lines.push(`Market State: ${marketState}`)

  if (effectivePrice != null) {
    lines.push(`Effective Price: ${formatMoney(effectivePrice, snapshot.currency)}`)
  }

  if (snapshot.regularMarketPrice != null) {
    lines.push(`Regular Market Price: ${formatMoney(snapshot.regularMarketPrice, snapshot.currency)}`)
  }

  if (snapshot.preMarketPrice != null) {
    lines.push(`Premarket Price: ${formatMoney(snapshot.preMarketPrice, snapshot.currency)}`)
  }

  if (snapshot.postMarketPrice != null) {
    lines.push(`Postmarket Price: ${formatMoney(snapshot.postMarketPrice, snapshot.currency)}`)
  }

  if (snapshot.bid != null && snapshot.ask != null) {
    lines.push(`Bid/Ask: ${formatMoney(snapshot.bid, snapshot.currency)} / ${formatMoney(snapshot.ask, snapshot.currency)}`)
  }

  if (snapshot.dayLow != null && snapshot.dayHigh != null) {
    lines.push(`Day Range: ${formatMoney(snapshot.dayLow, snapshot.currency)} - ${formatMoney(snapshot.dayHigh, snapshot.currency)}`)
  }

  if (snapshot.fiftyTwoWeekLow != null && snapshot.fiftyTwoWeekHigh != null) {
    lines.push(`52W Range: ${formatMoney(snapshot.fiftyTwoWeekLow, snapshot.currency)} - ${formatMoney(snapshot.fiftyTwoWeekHigh, snapshot.currency)}`)
  }

  return lines
}
