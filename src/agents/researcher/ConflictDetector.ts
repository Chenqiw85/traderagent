import type { Finding } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { Conflict } from '../../types/quality.js'

type ConflictDetectorConfig = { readonly llm: ILLMProvider }

type MetricOverlap = { readonly metric: string; readonly bullClaim: string; readonly bearClaim: string }

const KNOWN_METRICS = [
  'P/E', 'P/B', 'EV/EBITDA', 'RSI', 'MACD', 'SMA50', 'SMA200',
  'beta', 'VaR', 'ATR', 'volatility', 'max drawdown', 'maxDrawdown',
  'ROE', 'margins', 'revenue growth', 'revenueGrowth', 'EPS',
  'debt-to-equity', 'debtToEquity', 'current ratio', 'currentRatio',
  'dividend yield', 'dividendYield', 'Bollinger', 'OBV', 'stochastic',
  'interest coverage', 'interestCoverage',
] as const

export class ConflictDetector {
  private readonly llm: ILLMProvider

  constructor(config: ConflictDetectorConfig) { this.llm = config.llm }

  findMetricOverlaps(bullFindings: Finding[], bearFindings: Finding[]): MetricOverlap[] {
    const overlaps: MetricOverlap[] = []
    const bullByMetric = this.extractMetricClaims(bullFindings)
    const bearByMetric = this.extractMetricClaims(bearFindings)
    for (const [metric, bullClaim] of bullByMetric.entries()) {
      const bearClaim = bearByMetric.get(metric)
      if (bearClaim) overlaps.push({ metric, bullClaim, bearClaim })
    }
    return overlaps
  }

  async checkContradictions(overlaps: MetricOverlap[]): Promise<Conflict[]> {
    const conflicts: Conflict[] = []
    for (const overlap of overlaps) {
      const prompt = `Two stock analysts cite the same metric but reach different conclusions. Determine if their interpretations genuinely contradict each other or if they are compatible framings of the same data.

METRIC: ${overlap.metric}
BULL CLAIM: ${overlap.bullClaim}
BEAR CLAIM: ${overlap.bearClaim}

A contradiction means the two claims cannot both be true at the same time. Compatible framings mean both interpretations are valid perspectives on the same data point.

Respond with ONLY valid JSON (no markdown fencing):
{ "isContradiction": boolean, "severity": "high" | "medium" | "low" }`

      try {
        const response = await this.llm.chat([{ role: 'user', content: prompt }])
        const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
        const parsed = JSON.parse(cleaned) as { isContradiction: boolean; severity: 'high' | 'medium' | 'low' }
        conflicts.push({ metric: overlap.metric, bullClaim: overlap.bullClaim, bearClaim: overlap.bearClaim, isContradiction: parsed.isContradiction, severity: parsed.severity })
      } catch {
        conflicts.push({ metric: overlap.metric, bullClaim: overlap.bullClaim, bearClaim: overlap.bearClaim, isContradiction: false, severity: 'low' })
      }
    }
    return conflicts
  }

  private extractMetricClaims(findings: Finding[]): Map<string, string> {
    const claims = new Map<string, string>()
    for (const finding of findings) {
      for (const evidence of finding.evidence) {
        const upper = evidence.toUpperCase()
        for (const metric of KNOWN_METRICS) {
          if (upper.includes(metric.toUpperCase())) {
            const normalized = this.normalizeMetric(metric)
            if (!claims.has(normalized)) claims.set(normalized, evidence)
          }
        }
      }
    }
    return claims
  }

  private normalizeMetric(metric: string): string {
    const aliases: Record<string, string> = {
      'max drawdown': 'maxDrawdown', 'revenue growth': 'revenueGrowth',
      'debt-to-equity': 'debtToEquity', 'current ratio': 'currentRatio',
      'dividend yield': 'dividendYield', 'interest coverage': 'interestCoverage',
    }
    return aliases[metric.toLowerCase()] ?? metric
  }
}
