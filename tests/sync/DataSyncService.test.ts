// tests/sync/DataSyncService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataQuery, DataResult } from '../../src/agents/base/types.js'
import { RateLimitError } from '../../src/data/errors.js'
import { RateLimitedDataSource } from '../../src/data/RateLimitedDataSource.js'

const mockOhlcvCreateMany = vi.fn()
const mockFundamentalsCreate = vi.fn()
const mockNewsCreateMany = vi.fn()
const mockTechnicalsUpsert = vi.fn()
const mockFetchLogCreate = vi.fn()
const mockWatchlistFindMany = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  prisma: {
    ohlcv: { createMany: mockOhlcvCreateMany },
    fundamentals: { create: mockFundamentalsCreate },
    news: { createMany: mockNewsCreateMany },
    technicals: { upsert: mockTechnicalsUpsert },
    fetchLog: { create: mockFetchLogCreate },
    watchlist: { findMany: mockWatchlistFindMany },
  },
}))

const { DataSyncService } = await import('../../src/sync/DataSyncService.js')

function makeSource(name: string, fetchFn: (q: DataQuery) => Promise<DataResult>): IDataSource {
  return { name, fetch: fetchFn }
}

describe('DataSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTechnicalsUpsert.mockResolvedValue({})
  })

  it('fetches all data types for a ticker and logs success', async () => {
    const source = makeSource('test-source', async (q) => ({
      ticker: q.ticker,
      market: q.market,
      type: q.type,
      data: { mock: true },
      fetchedAt: new Date(),
    }))

    mockOhlcvCreateMany.mockResolvedValue({ count: 1 })
    mockFundamentalsCreate.mockResolvedValue({})
    mockNewsCreateMany.mockResolvedValue({ count: 1 })
    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([source])
    await service.syncTicker('AAPL', 'US')

    // Should log success for each data type
    expect(mockFetchLogCreate).toHaveBeenCalledTimes(4) // ohlcv, fundamentals, news, technicals
  })

  it('retries on transient failure and eventually succeeds', async () => {
    let callCount = 0
    const source = makeSource('flaky', async (q) => {
      callCount++
      if (callCount <= 2) throw new Error('Connection timeout')
      return { ticker: q.ticker, market: q.market, type: q.type, data: {}, fetchedAt: new Date() }
    })

    mockOhlcvCreateMany.mockResolvedValue({ count: 0 })
    mockFundamentalsCreate.mockResolvedValue({})
    mockNewsCreateMany.mockResolvedValue({ count: 0 })
    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([source], { maxRetries: 3, baseDelayMs: 1 })
    await service.syncTicker('AAPL', 'US')

    // First data type failed twice then succeeded
    expect(callCount).toBeGreaterThan(2)
  })

  it('logs failure after all retries exhausted', async () => {
    const source = makeSource('broken', async () => {
      throw new Error('API down')
    })

    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([source], { maxRetries: 2, baseDelayMs: 1 })
    await service.syncTicker('AAPL', 'US')

    // Should have logged failures
    const failCalls = mockFetchLogCreate.mock.calls.filter(
      (call: any[]) => call[0].data.status === 'failed'
    )
    expect(failCalls.length).toBeGreaterThan(0)
  })

  it('retries on RateLimitError with separate budget and succeeds', async () => {
    let callCount = 0
    const source = makeSource('rate-limited', async (q) => {
      callCount++
      if (callCount <= 1) throw new RateLimitError('rate-limited', 429, 10)
      return { ticker: q.ticker, market: q.market, type: q.type, data: {}, fetchedAt: new Date() }
    })

    mockOhlcvCreateMany.mockResolvedValue({ count: 0 })
    mockFundamentalsCreate.mockResolvedValue({})
    mockNewsCreateMany.mockResolvedValue({ count: 0 })
    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([source], { maxRetries: 1, baseDelayMs: 1, rateLimitBackoffFloorMs: 10 })
    await service.syncTicker('AAPL', 'US')

    expect(callCount).toBeGreaterThan(1)
    const successCalls = mockFetchLogCreate.mock.calls.filter(
      (call: any[]) => call[0].data.status === 'success'
    )
    expect(successCalls.length).toBeGreaterThan(0)
  })

  it('does not count 429 retries against normal retry budget', async () => {
    let callCount = 0
    const source = makeSource('mixed-errors', async (q) => {
      callCount++
      if (callCount === 1) throw new RateLimitError('mixed-errors', 429, 10)
      if (callCount === 2) throw new Error('Server error')
      return { ticker: q.ticker, market: q.market, type: q.type, data: {}, fetchedAt: new Date() }
    })

    mockOhlcvCreateMany.mockResolvedValue({ count: 0 })
    mockFundamentalsCreate.mockResolvedValue({})
    mockNewsCreateMany.mockResolvedValue({ count: 0 })
    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([source], { maxRetries: 2, baseDelayMs: 1, rateLimitBackoffFloorMs: 10 })
    await service.syncTicker('AAPL', 'US')

    expect(callCount).toBeGreaterThanOrEqual(3)
  })

  it('calls adjustRate on RateLimitedDataSource when 429 is received', async () => {
    vi.useFakeTimers()

    let callCount = 0
    const inner = makeSource('adjustable', async (q) => {
      callCount++
      if (callCount <= 1) throw new RateLimitError('adjustable', 429, 10)
      return { ticker: q.ticker, market: q.market, type: q.type, data: {}, fetchedAt: new Date() }
    })

    const rateLimited = new RateLimitedDataSource(inner, {
      intervalCap: 60, intervalMs: 60000, concurrency: 1,
    })
    const adjustSpy = vi.spyOn(rateLimited, 'adjustRate')

    mockOhlcvCreateMany.mockResolvedValue({ count: 0 })
    mockFundamentalsCreate.mockResolvedValue({})
    mockNewsCreateMany.mockResolvedValue({ count: 0 })
    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([rateLimited], { maxRetries: 1, baseDelayMs: 1, rateLimitBackoffFloorMs: 10 })
    const syncPromise = service.syncTicker('AAPL', 'US')

    // Advance past the rate-limit backoff delay and adjustRate cooldown timer
    await vi.advanceTimersByTimeAsync(70_000)
    await syncPromise

    expect(adjustSpy).toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('syncAll iterates all active watchlist tickers', async () => {
    mockWatchlistFindMany.mockResolvedValue([
      { ticker: 'AAPL', market: 'US', active: true },
      { ticker: 'MSFT', market: 'US', active: true },
    ])

    const fetchedTickers: string[] = []
    const source = makeSource('tracker', async (q) => {
      fetchedTickers.push(q.ticker)
      return { ticker: q.ticker, market: q.market, type: q.type, data: {}, fetchedAt: new Date() }
    })

    mockOhlcvCreateMany.mockResolvedValue({ count: 0 })
    mockFundamentalsCreate.mockResolvedValue({})
    mockNewsCreateMany.mockResolvedValue({ count: 0 })
    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([source], { maxRetries: 1, baseDelayMs: 1 })
    await service.syncAll()

    expect(fetchedTickers).toContain('AAPL')
    expect(fetchedTickers).toContain('MSFT')
  })

  it('upserts technical indicators using a day-scoped key', async () => {
    const technicalsSource = makeSource('technicals-source', async (q) => {
      if (q.type === 'technicals') {
        return {
          ticker: q.ticker,
          market: q.market,
          type: q.type,
          data: {
            trend: { sma50: 150 },
            risk: { beta: 1.1 },
          },
          fetchedAt: new Date('2026-04-05T12:00:00Z'),
        }
      }

      return {
        ticker: q.ticker,
        market: q.market,
        type: q.type,
        data: [],
        fetchedAt: new Date('2026-04-05T12:00:00Z'),
      }
    })

    mockOhlcvCreateMany.mockResolvedValue({ count: 0 })
    mockFundamentalsCreate.mockResolvedValue({})
    mockNewsCreateMany.mockResolvedValue({ count: 0 })
    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([technicalsSource])
    await service.syncTicker('AAPL', 'US')

    expect(mockTechnicalsUpsert).toHaveBeenCalledWith({
      where: {
        ticker_market_date: {
          ticker: 'AAPL',
          market: 'US',
          date: new Date('2026-04-05T00:00:00.000Z'),
        },
      },
      create: {
        ticker: 'AAPL',
        market: 'US',
        date: new Date('2026-04-05T00:00:00.000Z'),
        indicators: {
          trend: { sma50: 150 },
          risk: { beta: 1.1 },
        },
      },
      update: {
        indicators: {
          trend: { sma50: 150 },
          risk: { beta: 1.1 },
        },
      },
    })
  })
})
