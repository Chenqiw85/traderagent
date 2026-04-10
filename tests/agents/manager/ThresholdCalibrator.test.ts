import { describe, it, expect } from 'vitest'
import { ThresholdCalibrator } from '../../../src/agents/manager/ThresholdCalibrator.js'
import type { ScoredDecision } from '../../../src/agents/trader/types.js'

function makeScoredDecision(action: string, compositeScore: number, actualReturn: number): ScoredDecision {
  return {
    date: new Date('2026-04-01'),
    decision: {
      action: action as ScoredDecision['decision']['action'],
      confidence: 0.7,
      reasoning: 'test',
      suggestedPositionSize: 0.03,
      stopLoss: 95,
      takeProfit: 110,
    },
    actualReturn,
    hitTakeProfit: actualReturn > 0,
    hitStopLoss: actualReturn < -0.05,
    breakdown: {
      realizedTier: actualReturn >= 0.05 ? 'BUY' : actualReturn >= 0.02 ? 'OVERWEIGHT' : actualReturn >= -0.02 ? 'HOLD' : actualReturn >= -0.05 ? 'UNDERWEIGHT' : 'SELL',
      exactTierHit: false,
      tierDistanceScore: 0.75,
      directionalScore: 0.75,
      calibrationScore: 0.7,
      holdQualityScore: 1,
      riskExecutionScore: 0.5,
    },
    compositeScore,
  }
}

describe('ThresholdCalibrator', () => {
  const calibrator = new ThresholdCalibrator()

  it('returns default thresholds when sample size too small', () => {
    const decisions = [makeScoredDecision('BUY', 0.8, 0.06)]

    const result = calibrator.calibrate(decisions)

    expect(result.calibrationConfidence).toBeLessThan(0.5)
    expect(result.thresholds.strongBuy).toBe(6)
    expect(result.thresholds.buy).toBe(3)
  })

  it('calibrates thresholds from sufficient historical data', () => {
    const decisions: ScoredDecision[] = []
    for (let i = 0; i < 50; i++) {
      const score = (i / 50) * 0.9 + 0.1
      const ret = (i - 25) / 100
      const action = ret > 0.05 ? 'BUY' : ret > 0.02 ? 'OVERWEIGHT' : ret > -0.02 ? 'HOLD' : ret > -0.05 ? 'UNDERWEIGHT' : 'SELL'
      decisions.push(makeScoredDecision(action, score, ret))
    }

    const result = calibrator.calibrate(decisions)

    expect(result.sampleSize).toBe(50)
    expect(result.calibrationConfidence).toBeGreaterThan(0)
    expect(result.thresholds.strongBuy).toBeGreaterThan(result.thresholds.buy)
    expect(result.thresholds.buy).toBeGreaterThan(result.thresholds.hold[1])
    expect(result.thresholds.hold[0]).toBeLessThan(result.thresholds.hold[1])
    expect(result.thresholds.sell).toBeLessThan(result.thresholds.hold[0])
    expect(result.thresholds.strongSell).toBeLessThan(result.thresholds.sell)
  })

  it('produces dimension weights that sum to 1', () => {
    const decisions: ScoredDecision[] = []
    for (let i = 0; i < 30; i++) {
      decisions.push(makeScoredDecision('HOLD', 0.5, 0.01))
    }

    const result = calibrator.calibrate(decisions)
    const weightSum = Object.values(result.dimensionWeights).reduce((a, b) => a + b, 0)

    expect(weightSum).toBeCloseTo(1, 1)
  })

  it('sets calibratedAt to current time', () => {
    const decisions: ScoredDecision[] = []
    for (let i = 0; i < 30; i++) {
      decisions.push(makeScoredDecision('HOLD', 0.5, 0.01))
    }

    const before = new Date()
    const result = calibrator.calibrate(decisions)
    const after = new Date()

    expect(result.calibratedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(result.calibratedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})
