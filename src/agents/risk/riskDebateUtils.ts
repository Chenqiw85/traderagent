// src/agents/risk/riskDebateUtils.ts

import type { RiskAssessment, TradingReport } from '../base/types.js'

export type RiskDebateAssessment = {
  riskLevel?: string
  maxPositionSize?: number
  reasoning?: string
}

export function buildRiskMetricsContext(ticker: string, metrics: RiskAssessment['metrics']): string {
  return [
    `Risk metrics for ${ticker}:`,
    `  VaR (95%): ${(metrics.VaR * 100).toFixed(2)}%`,
    `  Volatility: ${(metrics.volatility * 100).toFixed(1)}%`,
    `  Beta: ${metrics.beta.toFixed(2)}`,
    `  Max Drawdown: ${(metrics.maxDrawdown * 100).toFixed(1)}%`,
  ].join('\n')
}

/**
 * Extracts previous-round risk debate arguments from analysisArtifacts,
 * excluding the current agent's own artifacts.
 */
export function extractDebateContext(report: TradingReport, currentAgent: string): string {
  const riskArtifacts = (report.analysisArtifacts ?? []).filter(
    (a) => a.stage === 'risk' && a.agent !== currentAgent,
  )
  if (riskArtifacts.length === 0) return ''

  const lines = ['\n=== OTHER RISK ANALYSTS\' ARGUMENTS ===']
  for (const artifact of riskArtifacts) {
    const payload = artifact.payload as RiskDebateAssessment | undefined
    lines.push(`[${artifact.agent}] Risk: ${payload?.riskLevel ?? '?'}, Position: ${payload?.maxPositionSize ?? '?'}`)
    if (artifact.summary) lines.push(`  Reasoning: ${artifact.summary}`)
  }
  return lines.join('\n')
}
