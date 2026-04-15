// src/agents/advisor/ReportFormatter.ts

import type { AdvisorReport, MarketTrend, TickerAdvisory } from './types.js'
import { isAbstainForecast } from './types.js'

const DIRECTION_ICON: Record<MarketTrend['direction'], string> = {
  bullish: '🟢',
  bearish: '🔴',
  neutral: '🟡',
}

const FORECAST_ICON: Record<string, string> = {
  up: '🟢 ↑ UP',
  down: '🔴 ↓ DOWN',
  flat: '🟡 → FLAT',
}

const ACTION_ICON: Record<string, string> = {
  BUY: '🟢 BUY',
  OVERWEIGHT: '🔵 OVERWEIGHT',
  HOLD: '🟡 HOLD',
  UNDERWEIGHT: '🟠 UNDERWEIGHT',
  SELL: '🔴 SELL',
}

function titleCase(value: string): string {
  return value.length > 0
    ? `${value[0].toUpperCase()}${value.slice(1)}`
    : value
}

function formatLegacyAdvisory(lines: string[], advisory: TickerAdvisory): void {
  const actionIcon = ACTION_ICON[advisory.decision.action] ?? advisory.decision.action
  const confidence = `${(advisory.decision.confidence * 100).toFixed(0)}%`
  lines.push(`${actionIcon} *${advisory.ticker}* (${confidence} confidence)`)
  lines.push(`   ${advisory.decision.reasoning}`)
  if (advisory.decision.stopLoss != null) {
    lines.push(`   SL: $${advisory.decision.stopLoss} | TP: $${advisory.decision.takeProfit ?? 'N/A'}`)
  }
  if (advisory.dailyUpdate) {
    const d = advisory.dailyUpdate.indicatorDelta
    const prevAction = advisory.dailyUpdate.previousDecision.action
    const changed = prevAction !== advisory.decision.action
    lines.push(`   ${changed ? '⚡ CHANGED' : '→ Unchanged'} from ${prevAction}`)
    lines.push(`   Price: $${d.closePrev.toFixed(2)} → $${d.closeNow.toFixed(2)} (${d.changePercent >= 0 ? '+' : ''}${d.changePercent.toFixed(2)}%)`)
    lines.push(`   ${advisory.dailyUpdate.deltaReasoning}`)
  }
  if (advisory.keyFindings.length > 0) {
    lines.push(`   Key: ${advisory.keyFindings.slice(0, 2).join('; ')}`)
  }
  lines.push('')
}

export function formatAdvisorReport(report: AdvisorReport): string {
  const lines: string[] = []

  // Header
  const dateStr = report.timestamp.toISOString().slice(0, 10)
  const timeStr = report.timestamp.toISOString().slice(11, 16)
  lines.push(`📊 *Daily Market Advisory*`)
  lines.push(`${dateStr} ${timeStr} UTC`)
  lines.push('')

  // Market Overview
  lines.push('━━━ *Market Overview* ━━━')
  for (const trend of report.marketTrends) {
    const icon = DIRECTION_ICON[trend.direction]
    const change = trend.changePercent >= 0
      ? `+${trend.changePercent.toFixed(2)}%`
      : `${trend.changePercent.toFixed(2)}%`
    lines.push(`${icon} *${trend.name}* $${trend.latestClose.toFixed(2)} (${change})`)
    lines.push(`   RSI: ${trend.rsi.toFixed(0)} | MACD: ${trend.macdHistogram > 0 ? '+' : ''}${trend.macdHistogram.toFixed(3)}`)
    lines.push(`   ${trend.summary}`)
    lines.push('')
  }

  // Ticker Recommendations
  if (report.tickerAdvisories.length > 0) {
    const hasForecasts = report.tickerAdvisories.some((advisory) => advisory.forecast)
    lines.push(hasForecasts ? '━━━ *Next-Day Forecasts* ━━━' : '━━━ *Recommendations* ━━━')
    for (const advisory of report.tickerAdvisories) {
      if (advisory.forecast && isAbstainForecast(advisory.forecast)) continue
      if (!advisory.forecast) {
        formatLegacyAdvisory(lines, advisory)
        continue
      }

      const forecast = advisory.forecast
      const forecastIcon = FORECAST_ICON[forecast.predictedDirection] ?? forecast.predictedDirection.toUpperCase()
      const confidence = `${(forecast.confidence * 100).toFixed(0)}%`
      const baselineAction = advisory.baselineDecision?.action ?? advisory.decision.action
      lines.push(`${forecastIcon} *${advisory.ticker}* (${confidence} confidence)`)
      lines.push(`   Target: ${forecast.targetSession} | Ref: $${forecast.referencePrice.toFixed(2)} → $${forecast.targetPrice.toFixed(2)}`)
      lines.push(`   Baseline: ${baselineAction} | Change: ${titleCase(forecast.changeFromBaseline)}`)
      lines.push(`   ${forecast.reasoning}`)
      if (forecast.baselineReferencePrice != null) {
        lines.push(`   Baseline proposal ref: $${forecast.baselineReferencePrice.toFixed(2)}`)
      }
      if (advisory.keyFindings.length > 0) {
        lines.push(`   Key: ${advisory.keyFindings.slice(0, 2).join('; ')}`)
      }
      lines.push('')
    }
  }

  // Summary
  lines.push('━━━ *Summary* ━━━')
  lines.push(report.summary)

  return lines.join('\n')
}
