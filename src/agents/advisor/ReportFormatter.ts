// src/agents/advisor/ReportFormatter.ts

import type { AdvisorReport, MarketTrend, TickerAdvisory } from './types.js'

const DIRECTION_ICON: Record<MarketTrend['direction'], string> = {
  bullish: '🟢',
  bearish: '🔴',
  neutral: '🟡',
}

const ACTION_ICON: Record<string, string> = {
  BUY: '🟢 BUY',
  SELL: '🔴 SELL',
  HOLD: '🟡 HOLD',
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
    lines.push('━━━ *Recommendations* ━━━')
    for (const advisory of report.tickerAdvisories) {
      const actionIcon = ACTION_ICON[advisory.decision.action] ?? advisory.decision.action
      const confidence = `${(advisory.decision.confidence * 100).toFixed(0)}%`
      lines.push(`${actionIcon} *${advisory.ticker}* (${confidence} confidence)`)
      lines.push(`   ${advisory.decision.reasoning}`)
      if (advisory.decision.stopLoss != null) {
        lines.push(`   SL: $${advisory.decision.stopLoss} | TP: $${advisory.decision.takeProfit ?? 'N/A'}`)
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
