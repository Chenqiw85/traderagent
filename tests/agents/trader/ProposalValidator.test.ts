import { describe, it, expect } from 'vitest'
import { ProposalValidator } from '../../../src/agents/trader/ProposalValidator.js'
import type { TraderProposal, ResearchThesis } from '../../../src/agents/base/types.js'

function makeThesis(overrides: Partial<ResearchThesis> = {}): ResearchThesis {
  return {
    stance: 'bull',
    confidence: 0.8,
    summary: 'Strong bullish case',
    keyDrivers: ['momentum'],
    keyRisks: ['volatility'],
    invalidationConditions: ['breaks below SMA200'],
    timeHorizon: 'swing',
    ...overrides,
  }
}

function makeProposal(overrides: Partial<TraderProposal> = {}): TraderProposal {
  return {
    action: 'BUY',
    confidence: 0.7,
    summary: 'Buy on breakout',
    entryLogic: 'Break above 180',
    whyNow: 'MACD crossover',
    timeHorizon: 'swing',
    referencePrice: 175,
    stopLoss: 165,
    takeProfit: 195,
    invalidationConditions: ['breaks below 160'],
    ...overrides,
  }
}

describe('ProposalValidator', () => {
  const validator = new ProposalValidator()

  it('passes valid aligned BUY proposal with bull thesis', () => {
    const result = validator.validate(makeProposal(), makeThesis())
    expect(result.valid).toBe(true)
    expect(result.directionAligned).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('fails when proposal BUY contradicts BEAR thesis', () => {
    const result = validator.validate(
      makeProposal({ action: 'BUY' }),
      makeThesis({ stance: 'bear' }),
    )
    expect(result.valid).toBe(false)
    expect(result.directionAligned).toBe(false)
    expect(result.violations[0]).toContain('direction')
  })

  it('allows OVERWEIGHT with bull thesis', () => {
    const result = validator.validate(
      makeProposal({ action: 'OVERWEIGHT' }),
      makeThesis({ stance: 'bull' }),
    )
    expect(result.directionAligned).toBe(true)
  })

  it('allows SELL with bear thesis', () => {
    const result = validator.validate(
      makeProposal({ action: 'SELL', referencePrice: 175, stopLoss: 185, takeProfit: 155 }),
      makeThesis({ stance: 'bear' }),
    )
    expect(result.directionAligned).toBe(true)
  })

  it('requires HOLD for neutral thesis', () => {
    const result = validator.validate(
      makeProposal({ action: 'BUY' }),
      makeThesis({ stance: 'neutral' }),
    )
    expect(result.valid).toBe(false)
    expect(result.directionAligned).toBe(false)
  })

  it('validates R:R ratio — rejects below 2:1', () => {
    const result = validator.validate(
      makeProposal({ referencePrice: 175, stopLoss: 165, takeProfit: 180 }),
      makeThesis(),
    )
    expect(result.rrRatioValid).toBe(false)
    expect(result.computedRR).toBeCloseTo(0.5)
  })

  it('validates price sanity — stop below entry for long', () => {
    const result = validator.validate(
      makeProposal({ referencePrice: 175, stopLoss: 180, takeProfit: 195 }),
      makeThesis(),
    )
    expect(result.priceSane).toBe(false)
  })

  it('validates price sanity — stop above entry for short', () => {
    const result = validator.validate(
      makeProposal({ action: 'SELL', referencePrice: 175, stopLoss: 170, takeProfit: 155 }),
      makeThesis({ stance: 'bear' }),
    )
    expect(result.priceSane).toBe(false)
  })

  it('validates confidence consistency — proposal <= thesis', () => {
    const result = validator.validate(
      makeProposal({ confidence: 0.9 }),
      makeThesis({ confidence: 0.5 }),
    )
    expect(result.confidenceConsistent).toBe(false)
  })

  it('rejects directional proposal missing executable price levels', () => {
    const result = validator.validate(
      makeProposal({ action: 'BUY', referencePrice: undefined, stopLoss: undefined, takeProfit: undefined }),
      makeThesis(),
    )
    expect(result.valid).toBe(false)
    expect(result.violations).toContain('directional proposal missing executable price levels (referencePrice, stopLoss, takeProfit)')
  })

  it('allows HOLD proposal without price targets', () => {
    const result = validator.validate(
      makeProposal({ action: 'HOLD', referencePrice: undefined, stopLoss: undefined, takeProfit: undefined }),
      makeThesis({ stance: 'neutral' }),
    )
    expect(result.valid).toBe(true)
    expect(result.rrRatioValid).toBe(true)
    expect(result.priceSane).toBe(true)
  })
})
