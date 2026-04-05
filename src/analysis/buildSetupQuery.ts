import type { TradingReport } from '../agents/base/types.js'

function formatNumber(value: number, decimals = 1): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : ''
}

function buildThesisCue(report: TradingReport): string[] {
  const thesis = report.researchThesis
  if (!thesis) return []

  const stanceCue =
    thesis.stance === 'bull'
      ? 'bullish setup'
      : thesis.stance === 'bear'
        ? 'bearish setup'
        : 'neutral setup'

  const cues = [stanceCue, `${thesis.timeHorizon} horizon`]
  if (thesis.summary.trim().length > 0) {
    cues.push(thesis.summary.trim())
  }
  return cues
}

function buildFindingCue(report: TradingReport): string[] {
  const findings = report.researchFindings.filter((finding) => finding.agentName !== 'researchManager')
  if (findings.length === 0) return []

  const bullCount = findings.filter((finding) => finding.stance === 'bull').length
  const bearCount = findings.filter((finding) => finding.stance === 'bear').length

  if (bullCount > bearCount) return ['bullish research consensus']
  if (bearCount > bullCount) return ['bearish research consensus']
  return ['mixed research debate']
}

function buildIndicatorCues(report: TradingReport): string[] {
  const indicators = report.computedIndicators
  if (!indicators) return []

  const cues: string[] = []
  const { sma50, sma200, macd } = indicators.trend
  const { rsi } = indicators.momentum
  const { historicalVolatility } = indicators.volatility

  if (sma50 > sma200) {
    cues.push('uptrend regime')
  } else if (sma50 < sma200) {
    cues.push('downtrend regime')
  } else {
    cues.push('range-bound regime')
  }

  if (rsi >= 70) {
    cues.push(`RSI overbought ${formatNumber(rsi, 1)}`)
  } else if (rsi <= 30) {
    cues.push(`RSI oversold ${formatNumber(rsi, 1)}`)
  } else if (rsi >= 55) {
    cues.push(`RSI bullish momentum ${formatNumber(rsi, 1)}`)
  } else if (rsi <= 45) {
    cues.push(`RSI bearish momentum ${formatNumber(rsi, 1)}`)
  }

  if (historicalVolatility >= 0.35) {
    cues.push(`high-volatility regime ${formatNumber(historicalVolatility * 100, 1)}%`)
  } else if (historicalVolatility >= 0.2) {
    cues.push(`elevated-volatility regime ${formatNumber(historicalVolatility * 100, 1)}%`)
  } else {
    cues.push(`low-volatility regime ${formatNumber(historicalVolatility * 100, 1)}%`)
  }

  if (macd.line > macd.signal) {
    cues.push('positive MACD momentum')
  } else if (macd.line < macd.signal) {
    cues.push('negative MACD momentum')
  }

  return cues
}

export function buildSetupQuery(report: TradingReport): string {
  const parts = [
    'trading decision lessons',
    report.ticker,
    report.market,
    ...buildThesisCue(report),
    ...buildFindingCue(report),
    ...buildIndicatorCues(report),
  ]

  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ')
}
