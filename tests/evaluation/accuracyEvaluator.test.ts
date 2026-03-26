// tests/evaluation/accuracyEvaluator.test.ts
import { describe, it, expect } from 'vitest'
import { AccuracyEvaluator } from '../../src/evaluation/AccuracyEvaluator.js'
import type { TradingReport } from '../../src/agents/base/types.js'

function reportWithDecision(action: 'BUY' | 'SELL' | 'HOLD', confidence: number): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [],
    finalDecision: { action, confidence, reasoning: 'test' },
  }
}

describe('AccuracyEvaluator', () => {
  it('returns score 0 when report has no final decision', async () => {
    const report: TradingReport = {
      ticker: 'AAPL', market: 'US', timestamp: new Date(), rawData: [], researchFindings: [],
    }
    const evaluator = new AccuracyEvaluator(0.05)
    const result = await evaluator.evaluate(report)
    expect(result.score).toBe(0)
    expect(result.breakdown.directionalAccuracy).toBe(0)
  })

  it('directionalAccuracy = 1 when BUY and price went up', async () => {
    const evaluator = new AccuracyEvaluator(0.10)
    const result = await evaluator.evaluate(reportWithDecision('BUY', 0.9))
    expect(result.breakdown.directionalAccuracy).toBe(1)
  })

  it('directionalAccuracy = 0 when BUY and price went down', async () => {
    const evaluator = new AccuracyEvaluator(-0.05)
    const result = await evaluator.evaluate(reportWithDecision('BUY', 0.8))
    expect(result.breakdown.directionalAccuracy).toBe(0)
  })

  it('directionalAccuracy = 1 when SELL and price went down', async () => {
    const evaluator = new AccuracyEvaluator(-0.08)
    const result = await evaluator.evaluate(reportWithDecision('SELL', 0.7))
    expect(result.breakdown.directionalAccuracy).toBe(1)
  })

  it('directionalAccuracy = 0.5 for HOLD regardless of direction', async () => {
    const evaluator = new AccuracyEvaluator(0.05)
    const result = await evaluator.evaluate(reportWithDecision('HOLD', 0.5))
    expect(result.breakdown.directionalAccuracy).toBe(0.5)
  })

  it('score is average of directionalAccuracy and confidenceCalibration', async () => {
    const evaluator = new AccuracyEvaluator(0.10) // price up
    const result = await evaluator.evaluate(reportWithDecision('BUY', 0.9))
    // correct (directional = 1) + high confidence = confidenceCalibration = 0.9
    expect(result.score).toBeCloseTo((1 + 0.9) / 2)
  })
})
