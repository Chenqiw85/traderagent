import { describe, it, expect } from 'vitest'
import { FundamentalsScorer } from '../../../src/agents/researcher/FundamentalsScorer.js'
import type { TradingReport, DataResult, ComputedIndicators } from '../../../src/agents/base/types.js'

function makeReport(fundamentalsData: Record<string, unknown>, indicators?: Partial<ComputedIndicators>): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-08'),
    rawData: [
      { ticker: 'AAPL', market: 'US', type: 'fundamentals', data: fundamentalsData, fetchedAt: new Date() },
    ] as DataResult[],
    researchFindings: [],
    computedIndicators: {
      trend: { sma50: 170, sma200: 160, ema12: 175, ema26: 170, macd: { line: 5, signal: 3, histogram: 2 } },
      momentum: { rsi: 55, stochastic: { k: 60, d: 55 } },
      volatility: { bollingerUpper: 185, bollingerMiddle: 175, bollingerLower: 165, atr: 3.5, historicalVolatility: 0.25 },
      volume: { obv: 1000000 },
      risk: { beta: 1.1, maxDrawdown: 0.12, var95: 0.02 },
      fundamentals: { pe: 25, pb: 3.5, dividendYield: 0.015, eps: 6.5 },
      ...indicators,
    } as ComputedIndicators,
  }
}

describe('FundamentalsScorer', () => {
  const scorer = new FundamentalsScorer()

  it('scores a stock with all metrics available', () => {
    const report = makeReport({
      pe: 25, pb: 3.5, evToEbitda: 18,
      roe: 0.30, margins: 0.25, revenueGrowth: 0.15,
      debtToEquity: 0.5, currentRatio: 2.0, interestCoverage: 12,
      epsGrowth: 0.12,
    })
    const result = scorer.score(report)
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(100)
    expect(result.valuation + result.profitability + result.financialHealth + result.growth).toBe(result.total)
    expect(result.missingMetrics).toHaveLength(0)
  })

  it('prorates score when metrics are missing', () => {
    const report = makeReport({ pe: 15 })
    const result = scorer.score(report)
    expect(result.missingMetrics.length).toBeGreaterThan(0)
    expect(result.availableMetrics).toContain('pe')
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(100)
  })

  it('scores low valuation P/E as high valuation score', () => {
    const reportLow = makeReport({ pe: 10, pb: 1.0, evToEbitda: 8 })
    const reportHigh = makeReport({ pe: 80, pb: 12, evToEbitda: 50 })
    expect(scorer.score(reportLow).valuation).toBeGreaterThan(scorer.score(reportHigh).valuation)
  })

  it('scores strong profitability higher', () => {
    const reportStrong = makeReport({ roe: 0.30, margins: 0.25, revenueGrowth: 0.20 })
    const reportWeak = makeReport({ roe: 0.05, margins: 0.03, revenueGrowth: -0.05 })
    expect(scorer.score(reportStrong).profitability).toBeGreaterThan(scorer.score(reportWeak).profitability)
  })

  it('scores strong financial health higher', () => {
    const reportStrong = makeReport({ debtToEquity: 0.3, currentRatio: 2.5, interestCoverage: 15 })
    const reportWeak = makeReport({ debtToEquity: 3.0, currentRatio: 0.5, interestCoverage: 1.5 })
    expect(scorer.score(reportStrong).financialHealth).toBeGreaterThan(scorer.score(reportWeak).financialHealth)
  })

  it('returns zero total when no data available', () => {
    const report = makeReport({})
    const result = scorer.score(report)
    expect(result.total).toBe(0)
    expect(result.availableMetrics).toHaveLength(0)
  })
})
