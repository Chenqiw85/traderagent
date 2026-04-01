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

  describe('directional scoring', () => {
    it('scores 1 when BUY and price went up', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY' }),
        { actualReturn: 0.05, closePrices: [100, 101, 102, 103, 105] }
      )
      expect(result.breakdown.directional).toBe(1)
    })

    it('scores 0 when BUY and price went down', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY' }),
        { actualReturn: -0.03, closePrices: [100, 99, 98, 97, 97] }
      )
      expect(result.breakdown.directional).toBe(0)
    })

    it('scores 1 when SELL and price went down', () => {
      const result = scorer.score(
        makeDecision({ action: 'SELL' }),
        { actualReturn: -0.04, closePrices: [100, 99, 98, 97, 96] }
      )
      expect(result.breakdown.directional).toBe(1)
    })

    it('scores 0.5 for HOLD', () => {
      const result = scorer.score(
        makeDecision({ action: 'HOLD' }),
        { actualReturn: 0.05, closePrices: [100, 101, 102, 103, 105] }
      )
      expect(result.breakdown.directional).toBe(0.5)
    })
  })

  describe('target hit scoring', () => {
    it('scores 1 when take-profit hit', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', takeProfit: 110, stopLoss: 95 }),
        { actualReturn: 0.12, closePrices: [100, 103, 107, 110, 112] }
      )
      expect(result.breakdown.targetHit).toBe(1)
    })

    it('scores 0 when stop-loss hit', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', takeProfit: 110, stopLoss: 95 }),
        { actualReturn: -0.07, closePrices: [100, 98, 96, 94, 93] }
      )
      expect(result.breakdown.targetHit).toBe(0)
    })

    it('scores 0.5 when neither hit', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', takeProfit: 110, stopLoss: 95 }),
        { actualReturn: 0.02, closePrices: [100, 101, 100, 101, 102] }
      )
      expect(result.breakdown.targetHit).toBe(0.5)
    })

    it('scores 0.5 when no targets set', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', takeProfit: undefined, stopLoss: undefined }),
        { actualReturn: 0.05, closePrices: [100, 102, 103, 104, 105] }
      )
      expect(result.breakdown.targetHit).toBe(0.5)
    })
  })

  describe('calibration scoring', () => {
    it('high confidence + correct = high calibration', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', confidence: 0.9 }),
        { actualReturn: 0.05, closePrices: [100, 101, 102, 103, 105] }
      )
      expect(result.breakdown.calibration).toBe(0.9)
    })

    it('high confidence + wrong = low calibration', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', confidence: 0.9 }),
        { actualReturn: -0.05, closePrices: [100, 99, 98, 97, 95] }
      )
      expect(result.breakdown.calibration).toBeCloseTo(0.1)
    })

    it('low confidence + wrong = moderate calibration', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', confidence: 0.3 }),
        { actualReturn: -0.05, closePrices: [100, 99, 98, 97, 95] }
      )
      expect(result.breakdown.calibration).toBe(0.7)
    })
  })

  describe('hold penalty scoring', () => {
    it('HOLD on flat day = 1.0 (correct to hold)', () => {
      const result = scorer.score(
        makeDecision({ action: 'HOLD' }),
        { actualReturn: 0.005, closePrices: [100, 100.1, 100.2, 100.3, 100.5] }
      )
      expect(result.breakdown.holdPenalty).toBe(1)
    })

    it('HOLD on big up move = 0.0 (missed opportunity)', () => {
      const result = scorer.score(
        makeDecision({ action: 'HOLD' }),
        { actualReturn: 0.08, closePrices: [100, 102, 104, 106, 108] }
      )
      expect(result.breakdown.holdPenalty).toBe(0)
    })

    it('non-HOLD always gets 1.0 holdPenalty', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY' }),
        { actualReturn: 0.08, closePrices: [100, 102, 104, 106, 108] }
      )
      expect(result.breakdown.holdPenalty).toBe(1)
    })
  })

  describe('composite score', () => {
    it('computes weighted sum correctly', () => {
      const result = scorer.score(
        makeDecision({ action: 'BUY', confidence: 0.8 }),
        { actualReturn: 0.05, closePrices: [100, 101, 102, 103, 105] }
      )
      // directional=1, targetHit=0.5, calibration=0.8, holdPenalty=1
      const expected = 1 * 0.3 + 0.5 * 0.3 + 0.8 * 0.25 + 1 * 0.15
      expect(result.compositeScore).toBeCloseTo(expected)
    })
  })
})
