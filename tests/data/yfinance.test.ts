// tests/data/yfinance.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { YFinanceSource } from '../../src/data/yfinance.js'

const { mockChart, mockQuote, mockQuoteSummary, mockSearch } = vi.hoisted(() => {
  const mockChart = vi.fn().mockResolvedValue({
    quotes: [
      { date: new Date('2024-01-02'), open: 100, high: 105, low: 99, close: 103, volume: 1000000 },
      { date: new Date('2024-01-03'), open: 103, high: 107, low: 102, close: 106, volume: 1200000 },
    ],
    meta: { symbol: 'AAPL' },
  })
  const mockQuote = vi.fn().mockResolvedValue({
    symbol: 'AAPL',
    regularMarketPrice: 150,
    shortName: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    averageAnalystRating: '2.0 - Buy',
    targetMeanPrice: 200,
  })
  const mockQuoteSummary = vi.fn().mockResolvedValue({
    financialData: { currentPrice: 150 },
    defaultKeyStatistics: { trailingPE: 25 },
  })
  const mockSearch = vi.fn().mockResolvedValue({
    news: [{ title: 'AAPL hits new high', link: 'https://example.com/news/1' }],
  })
  return { mockChart, mockQuote, mockQuoteSummary, mockSearch }
})

vi.mock('yahoo-finance2', () => ({
  default: vi.fn().mockImplementation(() => ({
    chart: mockChart,
    quote: mockQuote,
    quoteSummary: mockQuoteSummary,
    search: mockSearch,
  })),
}))

describe('YFinanceSource', () => {
  let source: YFinanceSource

  beforeEach(() => {
    source = new YFinanceSource()
  })

  it('has correct name', () => {
    expect(source.name).toBe('yfinance')
  })

  it('fetches OHLCV data via chart()', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' })
    expect(result.ticker).toBe('AAPL')
    expect(result.type).toBe('ohlcv')
    expect(mockChart).toHaveBeenCalled()
    expect(result.data).toHaveProperty('quotes')
    expect(result.fetchedAt).toBeInstanceOf(Date)
  })

  it('fetches fundamentals data via quoteSummary + quote', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'fundamentals' })
    expect(result.type).toBe('fundamentals')
    expect(mockQuoteSummary).toHaveBeenCalled()
    expect(mockQuote).toHaveBeenCalled()
    expect(result.data).toHaveProperty('quoteSummary')
    expect(result.data).toHaveProperty('quote')
  })

  it('fetches news data via search + quote', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'news' })
    expect(result.type).toBe('news')
    expect(mockSearch).toHaveBeenCalled()
    expect(result.data).toHaveProperty('news')
    expect(result.data).toHaveProperty('sector', 'Technology')
  })

  it('fetches technicals data via chart()', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'technicals' })
    expect(result.type).toBe('technicals')
    expect(mockChart).toHaveBeenCalled()
    expect(result.data).toHaveProperty('quotes')
  })
})
