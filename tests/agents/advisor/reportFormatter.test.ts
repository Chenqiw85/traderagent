import { describe, expect, it } from 'vitest'
import { formatAdvisorReport } from '../../../src/agents/advisor/ReportFormatter.js'
import type { AdvisorReport } from '../../../src/agents/advisor/types.js'

function makeReport(): AdvisorReport {
  return {
    timestamp: new Date('2026-04-07T20:00:00.000Z'),
    marketTrends: [
      {
        ticker: 'SPY',
        name: 'S&P 500',
        market: 'US',
        latestClose: 520,
        changePercent: 0.5,
        direction: 'bullish',
        rsi: 58,
        macdHistogram: 1.2,
        sma50: 505,
        sma200: 470,
        summary: 'Breadth is improving.',
      },
    ],
    tickerAdvisories: [
      {
        ticker: 'AAPL',
        market: 'US',
        decision: {
          action: 'BUY',
          confidence: 0.7,
          reasoning: 'Baseline decision remains constructive.',
        },
        forecast: {
          predictedDirection: 'up',
          referencePrice: 183,
          targetPrice: 184,
          targetSession: '2026-04-08',
          confidence: 0.72,
          reasoning: 'Momentum strengthened the baseline thesis.',
          baselineAction: 'BUY',
          baselineReferencePrice: 183,
          changeFromBaseline: 'strengthened',
        },
        baselineAsOf: new Date('2026-04-07T20:00:00.000Z'),
        baselineSource: 'db',
        baselineDecision: {
          action: 'BUY',
          confidence: 0.7,
          reasoning: 'Baseline decision remains constructive.',
        },
        keyFindings: ['Baseline action: BUY', 'Fresh move: +1.09%'],
      },
    ],
    summary: 'US tech remains constructive into the next session.',
  }
}

describe('formatAdvisorReport', () => {
  it('prints forecast direction, anchor price, and baseline action', () => {
    const output = formatAdvisorReport(makeReport())

    expect(output).toContain('Target: 2026-04-08')
    expect(output).toContain('Ref: $183.00 → $184.00')
    expect(output).toContain('Baseline: BUY')
    expect(output).not.toContain('Daily Update:')
  })
})
