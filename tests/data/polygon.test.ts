// tests/data/polygon.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PolygonSource } from '../../src/data/polygon.js'

vi.mock('@polygon.io/client-js', () => ({
  restClient: vi.fn().mockReturnValue({
    stocks: {
      aggregates: vi.fn().mockResolvedValue({
        results: [
          { o: 100, h: 105, l: 99, c: 103, v: 1000000, t: 1704067200000 },
        ],
      }),
    },
    reference: {
      tickerNews: vi.fn().mockResolvedValue({
        results: [{ title: 'Market update', published_utc: '2024-01-01' }],
      }),
      tickerDetails: vi.fn().mockResolvedValue({
        results: { name: 'Apple Inc.', market_cap: 3000000000000 },
      }),
    },
  }),
}))

describe('PolygonSource', () => {
  let source: PolygonSource

  beforeEach(() => {
    source = new PolygonSource({ apiKey: 'test-key' })
  })

  it('has correct name', () => {
    expect(source.name).toBe('polygon')
  })

  it('fetches OHLCV data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' })
    expect(result.ticker).toBe('AAPL')
    expect(result.type).toBe('ohlcv')
    expect(result.data).toBeDefined()
  })

  it('fetches news', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'news' })
    expect(result.type).toBe('news')
  })

  it('fetches fundamentals', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'fundamentals' })
    expect(result.type).toBe('fundamentals')
  })
})
