import { describe, it, expect } from 'vitest'
import { calcBeta, calcMaxDrawdown, calcVaR } from '../../src/indicators/risk.js'

describe('calcBeta', () => {
  it('returns 1.0 when stock returns match market returns', () => {
    const returns = [0.01, -0.02, 0.03, -0.01, 0.02, 0.01, -0.03, 0.02, 0.01, -0.01]
    expect(calcBeta(returns, returns)).toBeCloseTo(1.0, 5)
  })
  it('returns 2.0 when stock moves at 2x market', () => {
    const market = [0.01, -0.02, 0.03, -0.01, 0.02, 0.01, -0.03, 0.02, 0.01, -0.01]
    const stock = market.map((r) => r * 2)
    expect(calcBeta(stock, market)).toBeCloseTo(2.0, 5)
  })
  it('returns NaN when arrays are empty', () => {
    expect(calcBeta([], [])).toBeNaN()
  })
})

describe('calcMaxDrawdown', () => {
  it('calculates max peak-to-trough decline', () => {
    const prices = [100, 150, 200, 180, 150, 170, 190]
    expect(calcMaxDrawdown(prices)).toBeCloseTo(0.25, 5)
  })
  it('returns 0 for monotonically increasing prices', () => {
    expect(calcMaxDrawdown([100, 110, 120, 130])).toBeCloseTo(0, 5)
  })
  it('returns NaN for single price', () => {
    expect(calcMaxDrawdown([100])).toBeNaN()
  })
})

describe('calcVaR', () => {
  it('returns a positive number for the 95th percentile loss', () => {
    const returns = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000)
    expect(calcVaR(returns, 0.95)).toBeGreaterThan(0)
  })
  it('higher confidence → larger VaR', () => {
    const returns = Array.from({ length: 200 }, (_, i) => (i - 100) / 1000)
    expect(calcVaR(returns, 0.99)).toBeGreaterThan(calcVaR(returns, 0.90))
  })
  it('returns NaN for empty array', () => {
    expect(calcVaR([], 0.95)).toBeNaN()
  })
})
