import { describe, expect, it, vi } from 'vitest'
import { TickerAccuracyProvider } from '../../../src/agents/advisor/TickerAccuracyProvider.js'
import type { AdvisorForecastRow } from '../../../src/agents/advisor/AdvisorForecastRepository.js'

function row(overrides: Partial<AdvisorForecastRow>): AdvisorForecastRow {
  return {
    id: 'r', ticker: 'AAPL', market: 'US',
    issuedAt: new Date('2026-04-10T13:00:00Z'),
    targetSession: new Date('2026-04-11T00:00:00Z'),
    predictedDirection: 'up',
    referencePrice: 180, targetPrice: 182, confidence: 0.7,
    baselineAction: 'BUY',
    baselineAsOf: new Date('2026-04-10T00:00:00Z'),
    changeFromBaseline: 'strengthened',
    atrRangeLow: 178, atrRangeHigh: 184,
    scoringStatus: 'scored',
    actualClose: 183, actualDirection: 'up',
    scoredAt: new Date('2026-04-11T22:00:00Z'),
    ...overrides,
  }
}

describe('TickerAccuracyProvider', () => {
  it('returns null when fewer than 5 scored rows', async () => {
    const repo = { findRecentScored: vi.fn().mockResolvedValue([row({}), row({})]) }
    const provider = new TickerAccuracyProvider({ repository: repo as any })
    const stats = await provider.getStats('AAPL', 'US')
    expect(stats).toBeNull()
    expect(repo.findRecentScored).toHaveBeenCalledWith('AAPL', 'US', 20)
  })

  it('computes directional hit rate', async () => {
    const repo = { findRecentScored: vi.fn().mockResolvedValue([
      row({ predictedDirection: 'up', actualDirection: 'up' }),
      row({ predictedDirection: 'up', actualDirection: 'down' }),
      row({ predictedDirection: 'down', actualDirection: 'down' }),
      row({ predictedDirection: 'flat', actualDirection: 'flat' }),
      row({ predictedDirection: 'up', actualDirection: 'up' }),
    ]) }
    const provider = new TickerAccuracyProvider({ repository: repo as any })
    const stats = await provider.getStats('AAPL', 'US')
    expect(stats?.sampleSize).toBe(5)
    expect(stats?.directionalHitRate).toBeCloseTo(0.8)
  })

  it('buckets confidence at 0.70 and 0.50 boundaries', async () => {
    const rows = [
      row({ confidence: 0.70, predictedDirection: 'up', actualDirection: 'up' }),
      row({ confidence: 0.75, predictedDirection: 'up', actualDirection: 'down' }),
      row({ confidence: 0.69, predictedDirection: 'up', actualDirection: 'up' }),
      row({ confidence: 0.50, predictedDirection: 'up', actualDirection: 'up' }),
      row({ confidence: 0.49, predictedDirection: 'up', actualDirection: 'down' }),
      row({ confidence: 0.30, predictedDirection: 'up', actualDirection: 'up' }),
    ]
    const repo = { findRecentScored: vi.fn().mockResolvedValue(rows) }
    const provider = new TickerAccuracyProvider({ repository: repo as any })
    const stats = await provider.getStats('AAPL', 'US')
    expect(stats?.calibrationByBucket.high?.n).toBe(2)
    expect(stats?.calibrationByBucket.high?.actual).toBeCloseTo(0.5)
    expect(stats?.calibrationByBucket.moderate?.n).toBe(2)
    expect(stats?.calibrationByBucket.moderate?.actual).toBeCloseTo(1.0)
    expect(stats?.calibrationByBucket.low?.n).toBe(2)
    expect(stats?.calibrationByBucket.low?.actual).toBeCloseTo(0.5)
  })

  it('returns null for a bucket with fewer than 2 samples', async () => {
    const rows = [
      row({ confidence: 0.75 }),
      row({ confidence: 0.55 }),
      row({ confidence: 0.55 }),
      row({ confidence: 0.55 }),
      row({ confidence: 0.55 }),
    ]
    const repo = { findRecentScored: vi.fn().mockResolvedValue(rows) }
    const provider = new TickerAccuracyProvider({ repository: repo as any })
    const stats = await provider.getStats('AAPL', 'US')
    expect(stats?.calibrationByBucket.high).toBeNull()
    expect(stats?.calibrationByBucket.moderate?.n).toBe(4)
  })

  it('target-band hit rate counts rows where actualClose is within [atrRangeLow, atrRangeHigh]', async () => {
    const rows = [
      row({ actualClose: 183, atrRangeLow: 178, atrRangeHigh: 184 }),
      row({ actualClose: 178, atrRangeLow: 178, atrRangeHigh: 184 }),
      row({ actualClose: 184, atrRangeLow: 178, atrRangeHigh: 184 }),
      row({ actualClose: 177, atrRangeLow: 178, atrRangeHigh: 184 }),
      row({ actualClose: 190, atrRangeLow: 178, atrRangeHigh: 184 }),
    ]
    const repo = { findRecentScored: vi.fn().mockResolvedValue(rows) }
    const provider = new TickerAccuracyProvider({ repository: repo as any })
    const stats = await provider.getStats('AAPL', 'US')
    expect(stats?.targetBandHitRate).toBeCloseTo(0.6)
  })

  it('returns null target-band hit rate when no rows have atrRange fields', async () => {
    const rows = Array.from({ length: 5 }, () =>
      row({ atrRangeLow: null, atrRangeHigh: null }))
    const repo = { findRecentScored: vi.fn().mockResolvedValue(rows) }
    const provider = new TickerAccuracyProvider({ repository: repo as any })
    const stats = await provider.getStats('AAPL', 'US')
    expect(stats?.targetBandHitRate).toBeNull()
  })

  it('ignores rows with null actualClose or abstain direction', async () => {
    const rows = [
      row({}),
      row({}),
      row({}),
      row({ actualClose: null }),
      row({ predictedDirection: 'abstain' }),
      row({}),
    ]
    const repo = { findRecentScored: vi.fn().mockResolvedValue(rows) }
    const provider = new TickerAccuracyProvider({ repository: repo as any })
    const stats = await provider.getStats('AAPL', 'US')
    expect(stats?.sampleSize).toBe(4)
  })

  it('returns null when the repository throws', async () => {
    const repo = { findRecentScored: vi.fn().mockRejectedValue(new Error('db down')) }
    const provider = new TickerAccuracyProvider({ repository: repo as any })
    const stats = await provider.getStats('AAPL', 'US')
    expect(stats).toBeNull()
  })
})
