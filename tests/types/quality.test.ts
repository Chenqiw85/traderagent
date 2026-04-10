// tests/types/quality.test.ts
import { describe, it, expect } from 'vitest'
import type {
  DataQualityReport,
  DimensionQuality,
  EvidenceResult,
  Conflict,
  Resolution,
  ProposalValidation,
  CalibratedThresholds,
  FundamentalScores,
} from '../../src/types/quality.js'

describe('quality types', () => {
  it('DimensionQuality has required fields', () => {
    const dq: DimensionQuality = {
      available: ['P/E', 'P/B'],
      missing: ['revenueGrowth'],
      completeness: 0.67,
      staleness: '1 day old',
    }
    expect(dq.completeness).toBeGreaterThanOrEqual(0)
    expect(dq.completeness).toBeLessThanOrEqual(1)
    expect(dq.available.length + dq.missing.length).toBeGreaterThan(0)
  })

  it('DataQualityReport computes overall from dimensions', () => {
    const report: DataQualityReport = {
      fundamentals: { available: ['P/E'], missing: ['P/B'], completeness: 0.5 },
      news: { available: [], missing: ['headlines'], completeness: 0 },
      technicals: { available: ['RSI', 'MACD', 'SMA50'], missing: [], completeness: 1 },
      ohlcv: { available: ['bars'], missing: [], completeness: 1 },
      overall: 0.625,
      advisory: 'News data unavailable; fundamentals partial.',
    }
    expect(report.overall).toBeCloseTo(0.625)
  })

  it('EvidenceResult captures grounded and ungrounded claims', () => {
    const result: EvidenceResult = {
      agentName: 'bullResearcher',
      valid: false,
      violations: ['Claimed P/E of 12 but actual P/E is 25'],
      groundedEvidence: ['RSI at 45 matches computed RSI 44.8'],
      ungroundedClaims: ['P/E of 12'],
    }
    expect(result.valid).toBe(false)
    expect(result.violations.length).toBe(1)
  })

  it('Conflict captures metric contradiction between sides', () => {
    const conflict: Conflict = {
      metric: 'P/E',
      bullClaim: 'P/E of 25 is reasonable for tech sector',
      bearClaim: 'P/E of 25 is extreme vs market average of 18',
      isContradiction: true,
      severity: 'high',
    }
    expect(conflict.isContradiction).toBe(true)
  })

  it('Resolution records winner and adjusted confidence', () => {
    const resolution: Resolution = {
      conflict: {
        metric: 'P/E',
        bullClaim: 'reasonable for tech',
        bearClaim: 'extreme vs market',
        isContradiction: true,
        severity: 'high',
      },
      winner: 'bear',
      reasoning: 'P/E of 25 is above both sector and market median',
      adjustedConfidence: { bull: 0.4, bear: 0.8 },
    }
    expect(resolution.winner).toBe('bear')
  })

  it('ProposalValidation captures all check results', () => {
    const validation: ProposalValidation = {
      valid: false,
      directionAligned: false,
      rrRatioValid: true,
      priceSane: true,
      confidenceConsistent: true,
      computedRR: 2.5,
      violations: ['Thesis is BEAR but proposal action is BUY'],
    }
    expect(validation.valid).toBe(false)
    expect(validation.violations).toHaveLength(1)
  })

  it('CalibratedThresholds stores learned boundaries', () => {
    const thresholds: CalibratedThresholds = {
      calibratedAt: new Date('2026-04-08'),
      sampleSize: 150,
      calibrationConfidence: 0.82,
      thresholds: {
        strongBuy: 5.8,
        buy: 3.2,
        hold: [-2.1, 3.1],
        sell: -3.4,
        strongSell: -5.5,
      },
      dimensionWeights: {
        research: 0.3,
        technical: 0.25,
        fundamental: 0.2,
        risk: 0.15,
        proposal: 0.1,
      },
    }
    expect(thresholds.sampleSize).toBeGreaterThan(0)
    expect(thresholds.thresholds.hold[0]).toBeLessThan(thresholds.thresholds.hold[1])
  })

  it('FundamentalScores has four dimensions summing to 0-100', () => {
    const scores: FundamentalScores = {
      valuation: 18,
      profitability: 20,
      financialHealth: 15,
      growth: 22,
      total: 75,
      availableMetrics: ['P/E', 'ROE', 'debtToEquity', 'revenueGrowth'],
      missingMetrics: ['EV/EBITDA', 'currentRatio'],
    }
    expect(scores.valuation + scores.profitability + scores.financialHealth + scores.growth).toBe(scores.total)
    expect(scores.total).toBeGreaterThanOrEqual(0)
    expect(scores.total).toBeLessThanOrEqual(100)
  })
})
