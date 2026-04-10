import { describe, it, expect } from 'vitest'
import { CompositeScorer } from '../../../src/agents/trader/CompositeScorer.js'
import type { Decision } from '../../../src/agents/base/types.js'

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    action: 'BUY',
    confidence: 0.8,
    reasoning: 'test',
    stopLoss: 95,
    takeProfit: 110,
    ...overrides,
  }
}

describe('CompositeScorer', () => {
  const scorer = new CompositeScorer({ evaluationDays: 5 })

  describe('realized tier mapping', () => {
    it('maps +5% to BUY', () => {
      const result = scorer.score(makeDecision({ action: 'BUY' }), {
        actualReturn: 0.05,
        closePrices: [100, 101, 102, 103, 105],
      })
      expect(result.breakdown.realizedTier).toBe('BUY')
    })

    it('maps +3% to OVERWEIGHT', () => {
      const result = scorer.score(makeDecision({ action: 'BUY' }), {
        actualReturn: 0.03,
        closePrices: [100, 101, 101.5, 102, 103],
      })
      expect(result.breakdown.realizedTier).toBe('OVERWEIGHT')
    })

    it('maps flat returns to HOLD', () => {
      const result = scorer.score(makeDecision({ action: 'BUY' }), {
        actualReturn: 0.01,
        closePrices: [100, 100.5, 100.8, 100.9, 101],
      })
      expect(result.breakdown.realizedTier).toBe('HOLD')
    })

    it('maps -3% to UNDERWEIGHT', () => {
      const result = scorer.score(makeDecision({ action: 'BUY' }), {
        actualReturn: -0.03,
        closePrices: [100, 99.5, 99, 98.5, 97],
      })
      expect(result.breakdown.realizedTier).toBe('UNDERWEIGHT')
    })

    it('maps -5% to SELL', () => {
      const result = scorer.score(makeDecision({ action: 'BUY' }), {
        actualReturn: -0.05,
        closePrices: [100, 99, 98, 97, 95],
      })
      expect(result.breakdown.realizedTier).toBe('SELL')
    })
  })

  describe('tier distance scoring', () => {
    it('scores 1.0 for an exact tier hit', () => {
      const result = scorer.score(makeDecision({ action: 'BUY' }), {
        actualReturn: 0.06,
        closePrices: [100, 101, 102, 103, 106],
      })
      expect(result.breakdown.exactTierHit).toBe(true)
      expect(result.breakdown.tierDistanceScore).toBe(1)
    })

    it('scores 0.75 for one tier away', () => {
      const result = scorer.score(makeDecision({ action: 'BUY' }), {
        actualReturn: 0.03,
        closePrices: [100, 101, 101.5, 102, 103],
      })
      expect(result.breakdown.exactTierHit).toBe(false)
      expect(result.breakdown.tierDistanceScore).toBe(0.75)
    })

    it('scores 0.5 for two tiers away', () => {
      const result = scorer.score(makeDecision({ action: 'BUY' }), {
        actualReturn: 0.01,
        closePrices: [100, 100.5, 100.8, 100.9, 101],
      })
      expect(result.breakdown.tierDistanceScore).toBe(0.5)
    })

    it('scores 0.25 for three tiers away', () => {
      const result = scorer.score(makeDecision({ action: 'BUY' }), {
        actualReturn: -0.03,
        closePrices: [100, 99.5, 99, 98.5, 97],
      })
      expect(result.breakdown.tierDistanceScore).toBe(0.25)
    })

    it('scores 0.0 for four tiers away', () => {
      const result = scorer.score(makeDecision({ action: 'BUY' }), {
        actualReturn: -0.06,
        closePrices: [100, 99, 98, 97, 94],
      })
      expect(result.breakdown.tierDistanceScore).toBe(0)
    })
  })

  describe('directional score ladder', () => {
    it('scores 0.75 for OVERWEIGHT on a positive move', () => {
      const result = scorer.score(makeDecision({ action: 'OVERWEIGHT' }), {
        actualReturn: 0.03,
        closePrices: [100, 100.5, 101, 101.5, 103],
      })
      expect(result.breakdown.directionalScore).toBe(0.75)
    })

    it.each([
      ['OVERWEIGHT', -0.01, [100, 99.9, 99.8, 99.7, 99]] as const,
      ['UNDERWEIGHT', 0.01, [100, 100.1, 100.2, 100.3, 101]] as const,
    ])('scores 0.25 for a mild wrong-way %s call', (action, actualReturn, closePrices) => {
      const result = scorer.score(makeDecision({ action }), {
        actualReturn,
        closePrices,
      })
      expect(result.breakdown.directionalScore).toBe(0.25)
    })

    it('scores 0.75 for UNDERWEIGHT on a negative move', () => {
      const result = scorer.score(makeDecision({ action: 'UNDERWEIGHT' }), {
        actualReturn: -0.03,
        closePrices: [100, 99.5, 99, 98.5, 97],
      })
      expect(result.breakdown.directionalScore).toBe(0.75)
    })

    it('scores 0.25 for UNDERWEIGHT on a positive move', () => {
      const result = scorer.score(makeDecision({ action: 'UNDERWEIGHT' }), {
        actualReturn: 0.03,
        closePrices: [100, 100.5, 101, 101.5, 103],
      })
      expect(result.breakdown.directionalScore).toBe(0.25)
    })

    it('scores 0.5 for HOLD on any move', () => {
      const result = scorer.score(makeDecision({ action: 'HOLD' }), {
        actualReturn: 0.08,
        closePrices: [100, 101, 102, 103, 108],
      })
      expect(result.breakdown.directionalScore).toBe(0.5)
    })

    it('scores 0 for SELL on a flat move', () => {
      const result = scorer.score(makeDecision({ action: 'SELL' }), {
        actualReturn: 0,
        closePrices: [100, 100, 100, 100, 100],
      })
      expect(result.breakdown.directionalScore).toBe(0)
    })
  })

  describe('calibration scoring', () => {
    it('high confidence + correct = high calibration', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', confidence: 0.9 }),
        { actualReturn: 0.05, closePrices: [100, 101, 102, 103, 105] }
      )
      expect(result.breakdown.calibrationScore).toBe(0.9)
    })

    it('high confidence + wrong = low calibration', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', confidence: 0.9 }),
        { actualReturn: -0.05, closePrices: [100, 99, 98, 97, 95] }
      )
      expect(result.breakdown.calibrationScore).toBeCloseTo(0.1)
    })

    it('low confidence + wrong = moderate calibration', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', confidence: 0.3 }),
        { actualReturn: -0.05, closePrices: [100, 99, 98, 97, 95] }
      )
      expect(result.breakdown.calibrationScore).toBe(0.7)
    })

    it('BUY on +1% is a realized HOLD and low calibration', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', confidence: 0.8 }),
        { actualReturn: 0.01, closePrices: [100, 100.4, 100.7, 100.8, 101] }
      )
      expect(result.breakdown.realizedTier).toBe('HOLD')
      expect(result.breakdown.calibrationScore).toBeCloseTo(0.2)
    })

    it('UNDERWEIGHT on -1% is a realized HOLD and low calibration', () => {
      const result = scorer.score(
        makeDecision({ action: 'UNDERWEIGHT', confidence: 0.8 }),
        { actualReturn: -0.01, closePrices: [100, 99.8, 99.7, 99.6, 99] }
      )
      expect(result.breakdown.realizedTier).toBe('HOLD')
      expect(result.breakdown.calibrationScore).toBeCloseTo(0.2)
    })

    it('SELL on a flat move is a realized HOLD and low calibration', () => {
      const result = scorer.score(
        makeDecision({ action: 'SELL', confidence: 0.8 }),
        { actualReturn: 0, closePrices: [100, 100, 100, 100, 100] }
      )
      expect(result.breakdown.realizedTier).toBe('HOLD')
      expect(result.breakdown.calibrationScore).toBeCloseTo(0.2)
    })
  })

  describe('hold quality scoring', () => {
    it('HOLD on flat day = 1.0 (correct to hold)', () => {
      const result = scorer.score(
        makeDecision({ action: 'HOLD' }),
        { actualReturn: 0.005, closePrices: [100, 100.1, 100.2, 100.3, 100.5] }
      )
      expect(result.breakdown.holdQualityScore).toBe(1)
    })

    it('HOLD on big up move = 0.0 (missed opportunity)', () => {
      const result = scorer.score(
        makeDecision({ action: 'HOLD' }),
        { actualReturn: 0.08, closePrices: [100, 102, 104, 106, 108] }
      )
      expect(result.breakdown.holdQualityScore).toBe(0)
    })

    it('non-HOLD always gets 1.0 hold quality', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY' }),
        { actualReturn: 0.08, closePrices: [100, 102, 104, 106, 108] }
      )
      expect(result.breakdown.holdQualityScore).toBe(1)
    })
  })

  describe('risk execution scoring', () => {
    it('scores 1 when take-profit is hit before stop-loss', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', takeProfit: 110, stopLoss: 95 }),
        { actualReturn: 0.12, closePrices: [100, 103, 107, 110, 112] }
      )
      expect(result.breakdown.riskExecutionScore).toBe(1)
    })

    it('scores 0 when stop-loss is hit before take-profit', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', takeProfit: 110, stopLoss: 95 }),
        { actualReturn: -0.07, closePrices: [100, 98, 96, 94, 93] }
      )
      expect(result.breakdown.riskExecutionScore).toBe(0)
    })

    it('scores 0.5 when neither target nor stop are hit', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', takeProfit: 110, stopLoss: 95 }),
        { actualReturn: 0.02, closePrices: [100, 101, 100, 101, 102] }
      )
      expect(result.breakdown.riskExecutionScore).toBe(0.5)
    })

    it('scores 0.5 when no targets are set', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', takeProfit: undefined, stopLoss: undefined }),
        { actualReturn: 0.05, closePrices: [100, 102, 103, 104, 105] }
      )
      expect(result.breakdown.riskExecutionScore).toBe(0.5)
    })
  })

  describe('composite score', () => {
    it('computes weighted sum correctly', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', confidence: 0.8 }),
        { actualReturn: 0.05, closePrices: [100, 101, 102, 103, 105] }
      )
      // tierDistance=1, directional=1, calibration=0.8, holdQuality=1, riskExecution=0.5
      const expected = 1 * 0.3 + 1 * 0.2 + 0.8 * 0.2 + 1 * 0.1 + 0.5 * 0.2
      expect(result.compositeScore).toBeCloseTo(expected)
    })
  })
})
