import { describe, it, expect } from 'vitest'
import { calcOBV } from '../../src/indicators/volume.js'

describe('calcOBV', () => {
  it('accumulates volume on up days and subtracts on down days', () => {
    const closes = [100, 102, 101, 103, 104]
    const volumes = [1000, 1500, 1200, 1800, 2000]
    expect(calcOBV(closes, volumes)).toBe(4100)
  })
  it('returns 0 for flat prices', () => {
    expect(calcOBV([100, 100, 100], [1000, 1500, 1200])).toBe(0)
  })
  it('returns NaN for insufficient data', () => {
    expect(calcOBV([100], [1000])).toBeNaN()
  })
})
