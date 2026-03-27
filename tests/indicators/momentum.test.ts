import { describe, it, expect } from 'vitest'
import { calcRSI, calcStochastic } from '../../src/indicators/momentum.js'

describe('calcRSI', () => {
  it('returns 50 for flat prices (no gains or losses)', () => {
    const prices = Array.from({ length: 20 }, () => 100)
    expect(calcRSI(prices, 14)).toBeCloseTo(50, 0)
  })
  it('returns value near 100 for steadily rising prices', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i)
    expect(calcRSI(prices, 14)).toBeGreaterThan(95)
  })
  it('returns value near 0 for steadily falling prices', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 200 - i)
    expect(calcRSI(prices, 14)).toBeLessThan(5)
  })
  it('returns NaN when prices array is too short', () => {
    expect(calcRSI([10, 11], 14)).toBeNaN()
  })
})

describe('calcStochastic', () => {
  it('returns %K and %D values between 0 and 100', () => {
    const highs = Array.from({ length: 20 }, (_, i) => 110 + i)
    const lows = Array.from({ length: 20 }, (_, i) => 90 + i)
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i)
    const result = calcStochastic(highs, lows, closes, 14)
    expect(result.k).toBeGreaterThanOrEqual(0)
    expect(result.k).toBeLessThanOrEqual(100)
    expect(result.d).toBeGreaterThanOrEqual(0)
    expect(result.d).toBeLessThanOrEqual(100)
  })
  it('returns NaN when arrays are too short', () => {
    const result = calcStochastic([10], [5], [7], 14)
    expect(result.k).toBeNaN()
  })
})
