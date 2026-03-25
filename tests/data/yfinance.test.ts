// tests/data/yfinance.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { YFinanceSource } from '../../src/data/yfinance.js'

vi.mock('yahoo-finance2', () => {
  const mockInstance = {
    historical: vi.fn().mockResolvedValue([
      { date: '2024-01-01', open: 100, high: 105, low: 99, close: 103, volume: 1000000 },
      { date: '2024-01-02', open: 103, high: 107, low: 102, close: 106, volume: 1200000 },
    ]),
    quoteSummary: vi.fn().mockResolvedValue({
      financialData: { currentPrice: 150 },
      defaultKeyStatistics: { trailingPE: 25 },
    }),
    search: vi.fn().mockResolvedValue({
      news: [{ title: 'AAPL hits new high', link: 'https://example.com/news/1' }],
    }),
  }
  return {
    default: vi.fn().mockImplementation(() => mockInstance),
  }
})

describe('YFinanceSource', () => {
  let source: YFinanceSource

  beforeEach(() => {
    source = new YFinanceSource()
  })

  it('has correct name', () => {
    expect(source.name).toBe('yfinance')
  })

  it('fetches OHLCV data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' })
    expect(result.ticker).toBe('AAPL')
    expect(result.market).toBe('US')
    expect(result.type).toBe('ohlcv')
    expect(Array.isArray(result.data)).toBe(true)
    expect(result.fetchedAt).toBeInstanceOf(Date)
  })

  it('fetches fundamentals data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'fundamentals' })
    expect(result.type).toBe('fundamentals')
    expect(result.data).toBeDefined()
  })

  it('fetches news data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'news' })
    expect(result.type).toBe('news')
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('fetches technicals data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'technicals' })
    expect(result.type).toBe('technicals')
    expect(result.data).toBeDefined()
  })
})
