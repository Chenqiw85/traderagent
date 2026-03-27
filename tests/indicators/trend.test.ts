import { describe, it, expect } from 'vitest'
import { calcSMA, calcEMA, calcMACD } from '../../src/indicators/trend.js'

describe('calcSMA', () => {
  it('calculates simple moving average for given period', () => {
    const prices = [10, 11, 12, 13, 14]
    expect(calcSMA(prices, 3)).toBeCloseTo(13, 5)
  })
  it('returns NaN when prices array is shorter than period', () => {
    expect(calcSMA([10, 11], 5)).toBeNaN()
  })
})

describe('calcEMA', () => {
  it('calculates exponential moving average', () => {
    const prices = [10, 11, 12, 13, 14]
    expect(calcEMA(prices, 3)).toBeCloseTo(13, 5)
  })
  it('returns NaN when prices array is shorter than period', () => {
    expect(calcEMA([10], 5)).toBeNaN()
  })
})

describe('calcMACD', () => {
  it('returns line, signal, and histogram', () => {
    const prices = Array.from({ length: 50 }, (_, i) => 100 + i * 0.5 + Math.sin(i) * 2)
    const result = calcMACD(prices)
    expect(result).toHaveProperty('line')
    expect(result).toHaveProperty('signal')
    expect(result).toHaveProperty('histogram')
    expect(typeof result.line).toBe('number')
    expect(result.histogram).toBeCloseTo(result.line - result.signal, 10)
  })
  it('returns NaN values when prices array is too short', () => {
    const result = calcMACD([10, 11, 12])
    expect(result.line).toBeNaN()
  })
})
