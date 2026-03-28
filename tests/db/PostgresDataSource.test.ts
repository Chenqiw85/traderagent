// tests/db/PostgresDataSource.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DataQuery } from '../../src/agents/base/types.js'

// Mock Prisma client
const mockOhlcvFindMany = vi.fn()
const mockFundamentalsFindFirst = vi.fn()
const mockNewsFindMany = vi.fn()
const mockTechnicalsFindFirst = vi.fn()
const mockOhlcvCreateMany = vi.fn()
const mockFundamentalsCreate = vi.fn()
const mockNewsCreateMany = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  prisma: {
    ohlcv: { findMany: mockOhlcvFindMany, createMany: mockOhlcvCreateMany },
    fundamentals: { findFirst: mockFundamentalsFindFirst, create: mockFundamentalsCreate },
    news: { findMany: mockNewsFindMany, createMany: mockNewsCreateMany },
    technicals: { findFirst: mockTechnicalsFindFirst },
  },
}))

// Import after mock
const { PostgresDataSource } = await import('../../src/db/PostgresDataSource.js')

describe('PostgresDataSource', () => {
  let source: InstanceType<typeof PostgresDataSource>
  const now = new Date('2026-03-27T21:00:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(now)
    source = new PostgresDataSource()
  })

  it('has correct name', () => {
    expect(source.name).toBe('postgres')
  })

  describe('ohlcv', () => {
    const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'ohlcv' }

    it('returns data when fresh rows exist', async () => {
      const rows = [
        { ticker: 'AAPL', date: new Date('2026-03-27'), open: 150, high: 155, low: 149, close: 153, volume: BigInt(1000000) },
        { ticker: 'AAPL', date: new Date('2026-03-26'), open: 148, high: 152, low: 147, close: 150, volume: BigInt(900000) },
      ]
      mockOhlcvFindMany.mockResolvedValue(rows)

      const result = await source.fetch(query)
      expect(result.ticker).toBe('AAPL')
      expect(result.type).toBe('ohlcv')
      expect(result.data).toEqual(rows)
      expect(result.fetchedAt).toBeInstanceOf(Date)
    })

    it('throws when no rows exist', async () => {
      mockOhlcvFindMany.mockResolvedValue([])
      await expect(source.fetch(query)).rejects.toThrow('No ohlcv data for AAPL in postgres')
    })
  })

  describe('fundamentals', () => {
    const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'fundamentals' }

    it('returns data when fresh record exists', async () => {
      const record = {
        ticker: 'AAPL',
        data: { pe: 28.5, pb: 12.3 },
        fetchedAt: new Date('2026-03-27T10:00:00Z'),
      }
      mockFundamentalsFindFirst.mockResolvedValue(record)

      const result = await source.fetch(query)
      expect(result.type).toBe('fundamentals')
      expect(result.data).toEqual({ pe: 28.5, pb: 12.3 })
    })

    it('throws when record is stale (>24h old)', async () => {
      const record = {
        ticker: 'AAPL',
        data: { pe: 28.5 },
        fetchedAt: new Date('2026-03-25T10:00:00Z'),
      }
      mockFundamentalsFindFirst.mockResolvedValue(record)

      await expect(source.fetch(query)).rejects.toThrow('Stale fundamentals data for AAPL')
    })

    it('throws when no record exists', async () => {
      mockFundamentalsFindFirst.mockResolvedValue(null)
      await expect(source.fetch(query)).rejects.toThrow('No fundamentals data for AAPL in postgres')
    })
  })

  describe('news', () => {
    const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'news' }

    it('returns data when fresh articles exist', async () => {
      const articles = [
        { title: 'AAPL earnings', url: 'https://example.com/1', publishedAt: new Date('2026-03-27'), fetchedAt: new Date('2026-03-27T10:00:00Z') },
      ]
      mockNewsFindMany.mockResolvedValue(articles)

      const result = await source.fetch(query)
      expect(result.type).toBe('news')
      expect(result.data).toEqual(articles)
    })

    it('throws when no articles exist', async () => {
      mockNewsFindMany.mockResolvedValue([])
      await expect(source.fetch(query)).rejects.toThrow('No news data for AAPL in postgres')
    })
  })

  describe('technicals', () => {
    const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'technicals' }

    it('returns data when fresh record exists', async () => {
      const record = {
        ticker: 'AAPL',
        indicators: { sma50: 150, rsi14: 55 },
        computedAt: new Date('2026-03-27T10:00:00Z'),
      }
      mockTechnicalsFindFirst.mockResolvedValue(record)

      const result = await source.fetch(query)
      expect(result.type).toBe('technicals')
      expect(result.data).toEqual({ sma50: 150, rsi14: 55 })
    })

    it('throws when no record exists', async () => {
      mockTechnicalsFindFirst.mockResolvedValue(null)
      await expect(source.fetch(query)).rejects.toThrow('No technicals data for AAPL in postgres')
    })
  })

  describe('writeBack', () => {
    it('writes ohlcv data back to DB', async () => {
      mockOhlcvCreateMany.mockResolvedValue({ count: 2 })
      const bars = [
        { date: new Date('2026-03-27'), open: 150, high: 155, low: 149, close: 153, volume: 1000000 },
      ]
      await source.writeBack('AAPL', 'US', 'ohlcv', bars, 'yfinance')
      expect(mockOhlcvCreateMany).toHaveBeenCalled()
    })

    it('writes fundamentals data back to DB', async () => {
      mockFundamentalsCreate.mockResolvedValue({})
      await source.writeBack('AAPL', 'US', 'fundamentals', { pe: 28.5 }, 'yfinance')
      expect(mockFundamentalsCreate).toHaveBeenCalled()
    })
  })
})
