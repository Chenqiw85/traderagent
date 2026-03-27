import { describe, it, expect } from 'vitest'
import { calcBollinger, calcATR, calcHistoricalVolatility } from '../../src/indicators/volatility.js'

describe('calcBollinger', () => {
  it('returns equal bands for identical prices (stddev=0)', () => {
    const prices = Array.from({ length: 25 }, () => 100)
    const result = calcBollinger(prices, 20, 2)
    expect(result.middle).toBeCloseTo(100, 5)
    expect(result.upper).toBeCloseTo(100, 5)
    expect(result.lower).toBeCloseTo(100, 5)
  })
  it('upper > middle > lower for varying prices', () => {
    const prices = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 5)
    const result = calcBollinger(prices, 20, 2)
    expect(result.upper).toBeGreaterThan(result.middle)
    expect(result.middle).toBeGreaterThan(result.lower)
  })
  it('returns NaN when prices are too short', () => {
    expect(calcBollinger([10, 11], 20, 2).middle).toBeNaN()
  })
})

describe('calcATR', () => {
  it('returns positive ATR for varying prices', () => {
    const highs = Array.from({ length: 20 }, (_, i) => 105 + Math.sin(i) * 3)
    const lows = Array.from({ length: 20 }, (_, i) => 95 + Math.sin(i) * 3)
    const closes = Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i) * 3)
    expect(calcATR(highs, lows, closes, 14)).toBeGreaterThan(0)
  })
  it('returns NaN when arrays too short', () => {
    expect(calcATR([10], [5], [7], 14)).toBeNaN()
  })
})

describe('calcHistoricalVolatility', () => {
  it('returns 0 for flat prices', () => {
    const prices = Array.from({ length: 30 }, () => 100)
    expect(calcHistoricalVolatility(prices)).toBeCloseTo(0, 5)
  })
  it('returns positive value for varying prices', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10)
    expect(calcHistoricalVolatility(prices)).toBeGreaterThan(0)
  })
  it('returns NaN for insufficient data', () => {
    expect(calcHistoricalVolatility([100])).toBeNaN()
  })
})
