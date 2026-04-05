import { describe, it, expect, vi } from 'vitest'
import { DateFilteredDataSource } from '../../src/data/DateFilteredDataSource.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataQuery, DataResult } from '../../src/agents/base/types.js'

function mockSource(data: unknown): IDataSource {
  return {
    name: 'mock',
    fetch: vi.fn().mockResolvedValue({
      ticker: 'AAPL',
      market: 'US',
      type: 'ohlcv',
      data,
      fetchedAt: new Date(),
    } satisfies DataResult),
  }
}

const cutoff = new Date('2025-06-15')

describe('DateFilteredDataSource', () => {
  it('clamps query.to to cutoffDate', async () => {
    const inner = mockSource([])
    const filtered = new DateFilteredDataSource(inner, cutoff)

    const query: DataQuery = {
      ticker: 'AAPL',
      market: 'US',
      type: 'ohlcv',
      from: new Date('2025-01-01'),
      to: new Date('2025-12-31'), // after cutoff
    }

    await filtered.fetch(query)

    const passedQuery = (inner.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as DataQuery
    expect(passedQuery.to).toEqual(cutoff)
  })

  it('does not clamp query.to when already before cutoff', async () => {
    const inner = mockSource([])
    const filtered = new DateFilteredDataSource(inner, cutoff)
    const earlyDate = new Date('2025-06-10')

    const query: DataQuery = {
      ticker: 'AAPL',
      market: 'US',
      type: 'ohlcv',
      to: earlyDate,
    }

    await filtered.fetch(query)

    const passedQuery = (inner.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as DataQuery
    expect(passedQuery.to).toEqual(earlyDate)
  })

  it('filters OHLCV bars after cutoff date (array format)', async () => {
    const bars = [
      { date: '2025-06-10', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { date: '2025-06-15', open: 101, high: 102, low: 100, close: 101, volume: 1000 },
      { date: '2025-06-20', open: 102, high: 103, low: 101, close: 102, volume: 1000 }, // after cutoff
    ]
    const inner = mockSource(bars)
    const filtered = new DateFilteredDataSource(inner, cutoff)

    const result = await filtered.fetch({
      ticker: 'AAPL',
      market: 'US',
      type: 'ohlcv',
    })

    const data = result.data as typeof bars
    expect(data).toHaveLength(2)
    expect(data[0].date).toBe('2025-06-10')
    expect(data[1].date).toBe('2025-06-15')
  })

  it('filters OHLCV bars in Yahoo quotes format', async () => {
    const data = {
      quotes: [
        { date: '2025-06-10', close: 100 },
        { date: '2025-06-20', close: 102 }, // after cutoff
      ],
    }
    const inner = mockSource(data)
    const filtered = new DateFilteredDataSource(inner, cutoff)

    const result = await filtered.fetch({
      ticker: 'AAPL',
      market: 'US',
      type: 'ohlcv',
    })

    const resultData = result.data as { quotes: unknown[] }
    expect(resultData.quotes).toHaveLength(1)
  })

  it('filters Finnhub candle format by timestamp', async () => {
    const cutoffTs = cutoff.getTime() / 1000
    const data = {
      s: 'ok',
      t: [cutoffTs - 86400, cutoffTs, cutoffTs + 86400],
      c: [100, 101, 102],
      o: [99, 100, 101],
      h: [101, 102, 103],
      l: [98, 99, 100],
      v: [1000, 1000, 1000],
    }
    const inner = mockSource(data)
    const filtered = new DateFilteredDataSource(inner, cutoff)

    const result = await filtered.fetch({
      ticker: 'AAPL',
      market: 'US',
      type: 'ohlcv',
    })

    const resultData = result.data as { t: number[]; c: number[] }
    expect(resultData.t).toHaveLength(2)
    expect(resultData.c).toHaveLength(2)
  })

  it('filters news articles after cutoff', async () => {
    const articles = [
      { title: 'Old news', publishedAt: '2025-06-10T00:00:00Z' },
      { title: 'Future news', publishedAt: '2025-06-20T00:00:00Z' },
    ]
    const inner: IDataSource = {
      name: 'mock',
      fetch: vi.fn().mockResolvedValue({
        ticker: 'AAPL',
        market: 'US',
        type: 'news',
        data: articles,
        fetchedAt: new Date(),
      } satisfies DataResult),
    }
    const filtered = new DateFilteredDataSource(inner, cutoff)

    const result = await filtered.fetch({
      ticker: 'AAPL',
      market: 'US',
      type: 'news',
    })

    const data = result.data as typeof articles
    expect(data).toHaveLength(1)
    expect(data[0].title).toBe('Old news')
  })

  it('passes through fundamentals and technicals unchanged', async () => {
    const fundData = { pe: 25, eps: 5.2 }
    const inner: IDataSource = {
      name: 'mock',
      fetch: vi.fn().mockResolvedValue({
        ticker: 'AAPL',
        market: 'US',
        type: 'fundamentals',
        data: fundData,
        fetchedAt: new Date(),
      } satisfies DataResult),
    }
    const filtered = new DateFilteredDataSource(inner, cutoff)

    const result = await filtered.fetch({
      ticker: 'AAPL',
      market: 'US',
      type: 'fundamentals',
    })

    expect(result.data).toEqual(fundData)
  })

  it('includes the cutoff date in the source name', () => {
    const inner = mockSource([])
    const filtered = new DateFilteredDataSource(inner, cutoff)
    expect(filtered.name).toContain('2025-06-15')
  })
})
