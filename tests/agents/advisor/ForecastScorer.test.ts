import { describe, expect, it, vi } from 'vitest'
import { ForecastScorer } from '../../../src/agents/advisor/ForecastScorer.js'
import type { AdvisorForecastRow } from '../../../src/agents/advisor/AdvisorForecastRepository.js'

function makeRow(overrides: Partial<AdvisorForecastRow> = {}): AdvisorForecastRow {
  return {
    id: 'row-1',
    ticker: 'AAPL',
    market: 'US',
    issuedAt: new Date('2026-04-10T13:00:00Z'),
    targetSession: new Date('2026-04-11T00:00:00Z'),
    predictedDirection: 'up',
    referencePrice: 180,
    targetPrice: 182,
    confidence: 0.7,
    baselineAction: 'BUY',
    baselineAsOf: new Date('2026-04-10T00:00:00Z'),
    changeFromBaseline: 'strengthened',
    atrRangeLow: 178,
    atrRangeHigh: 184,
    scoringStatus: null,
    actualClose: null,
    actualDirection: null,
    scoredAt: null,
    ...overrides,
  }
}

function mockRepo(rows: AdvisorForecastRow[]) {
  return {
    findUnscored: vi.fn().mockResolvedValue(rows),
    markScored: vi.fn().mockResolvedValue(undefined),
  }
}

function mockDataSource(barsByDate: Record<string, number | undefined>) {
  return {
    fetch: vi.fn().mockImplementation(async ({ from }: { from: Date }) => {
      const key = from.toISOString().slice(0, 10)
      const close = barsByDate[key]
      return {
        source: 'test',
        type: 'ohlcv',
        ticker: 'AAPL',
        market: 'US',
        fetchedAt: new Date(),
        data: close !== undefined
          ? [{ date: `${key}T00:00:00Z`, open: close, high: close, low: close, close, volume: 1000 }]
          : [],
      }
    }),
  }
}

describe('ForecastScorer', () => {
  it('scores a row when a close is available for targetSession', async () => {
    const repo = mockRepo([makeRow()])
    const data = mockDataSource({ '2026-04-11': 182.5 })
    const scorer = new ForecastScorer({ repository: repo as any, dataSource: data as any })

    const result = await scorer.scorePending(new Date('2026-04-12T00:00:00Z'))

    expect(repo.markScored).toHaveBeenCalledWith('row-1', {
      actualClose: 182.5,
      actualDirection: 'up',
      status: 'scored',
    })
    expect(result).toEqual({ scored: 1, skipped: 0, errors: 0 })
  })

  it('classifies flat when move is under 0.5%', async () => {
    const repo = mockRepo([makeRow({ referencePrice: 180 })])
    const data = mockDataSource({ '2026-04-11': 180.5 })
    const scorer = new ForecastScorer({ repository: repo as any, dataSource: data as any })

    await scorer.scorePending(new Date('2026-04-12T00:00:00Z'))

    expect(repo.markScored).toHaveBeenCalledWith('row-1', expect.objectContaining({
      actualDirection: 'flat',
    }))
  })

  it('advances up to 3 days when target session has no bar', async () => {
    const repo = mockRepo([makeRow()])
    const data = mockDataSource({ '2026-04-13': 185 })
    const scorer = new ForecastScorer({ repository: repo as any, dataSource: data as any })

    const result = await scorer.scorePending(new Date('2026-04-14T00:00:00Z'))

    expect(repo.markScored).toHaveBeenCalledWith('row-1', {
      actualClose: 185,
      actualDirection: 'up',
      status: 'scored',
    })
    expect(result.scored).toBe(1)
  })

  it('marks as no-data when no bar found within 3 trading days', async () => {
    const repo = mockRepo([makeRow()])
    const data = mockDataSource({})
    const scorer = new ForecastScorer({ repository: repo as any, dataSource: data as any })

    const result = await scorer.scorePending(new Date('2026-04-20T00:00:00Z'))

    expect(repo.markScored).toHaveBeenCalledWith('row-1', {
      actualClose: null,
      actualDirection: null,
      status: 'no-data',
    })
    expect(result).toEqual({ scored: 0, skipped: 0, errors: 0 })
  })

  it('counts errors and continues when data source throws', async () => {
    const repo = mockRepo([makeRow({ id: 'r1' }), makeRow({ id: 'r2', ticker: 'MSFT' })])
    const data = {
      fetch: vi.fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce({
          source: 'test', type: 'ohlcv', ticker: 'MSFT', market: 'US', fetchedAt: new Date(),
          data: [{ date: '2026-04-11T00:00:00Z', open: 420, high: 420, low: 420, close: 422, volume: 1 }],
        }),
    }
    const scorer = new ForecastScorer({ repository: repo as any, dataSource: data as any })

    const result = await scorer.scorePending(new Date('2026-04-12T00:00:00Z'))

    expect(result).toEqual({ scored: 1, skipped: 0, errors: 1 })
    expect(repo.markScored).toHaveBeenCalledOnce()
    expect(repo.markScored).toHaveBeenCalledWith('r2', expect.objectContaining({ status: 'scored' }))
  })

  it('skips rows whose targetSession is still in the future', async () => {
    const repo = {
      findUnscored: vi.fn().mockResolvedValue([]),
      markScored: vi.fn(),
    }
    const data = mockDataSource({})
    const scorer = new ForecastScorer({ repository: repo as any, dataSource: data as any })

    const now = new Date('2026-04-10T00:00:00Z')
    await scorer.scorePending(now)

    expect(repo.findUnscored).toHaveBeenCalledWith(now)
  })
})
