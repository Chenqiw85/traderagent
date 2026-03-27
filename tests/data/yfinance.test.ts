// tests/data/yfinance.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { YFinanceSource } from '../../src/data/yfinance.js'

const { mockQuote, mockAutoc } = vi.hoisted(() => {
  const mockQuote = vi.fn().mockResolvedValue({
    symbol: 'AAPL',
    regularMarketPrice: 150,
    regularMarketOpen: 148,
    regularMarketDayHigh: 152,
    regularMarketDayLow: 147,
    regularMarketVolume: 50000000,
    regularMarketPreviousClose: 149,
    regularMarketChange: 1,
    regularMarketChangePercent: 0.67,
    fiftyTwoWeekHigh: 180,
    fiftyTwoWeekLow: 120,
    fiftyDayAverage: 155,
    twoHundredDayAverage: 145,
    averageDailyVolume3Month: 60000000,
    marketCap: 2400000000000,
    trailingPE: 25,
    forwardPE: 22,
    priceToBook: 40,
    epsTrailingTwelveMonths: 6.0,
    epsForward: 6.8,
    trailingAnnualDividendYield: 0.005,
    earningsTimestamp: new Date('2024-07-25'),
    targetMeanPrice: 200,
    numberOfAnalystOpinions: 40,
    averageAnalystRating: '2.0 - Buy',
    enterpriseValue: 2500000000000,
    priceToSalesTrailing12Months: 7.5,
    shortName: 'Apple Inc.',
    longName: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    exchange: 'NMS',
    quoteType: 'EQUITY',
  })
  const mockAutoc = vi.fn().mockResolvedValue({ Result: [{ symbol: 'AAPL', name: 'Apple Inc.' }] })
  return { mockQuote, mockAutoc }
})

vi.mock('yahoo-finance2', () => ({
  default: vi.fn().mockImplementation(() => ({
    quote: mockQuote,
    autoc: mockAutoc,
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

  it('fetches OHLCV data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' })
    expect(result.ticker).toBe('AAPL')
    expect(result.market).toBe('US')
    expect(result.type).toBe('ohlcv')
    expect(result.data).toHaveProperty('price', 150)
    expect(result.data).toHaveProperty('volume', 50000000)
    expect(result.fetchedAt).toBeInstanceOf(Date)
  })

  it('fetches fundamentals data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'fundamentals' })
    expect(result.type).toBe('fundamentals')
    expect(result.data).toHaveProperty('trailingPE', 25)
    expect(result.data).toHaveProperty('marketCap', 2400000000000)
  })

  it('fetches news data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'news' })
    expect(result.type).toBe('news')
    expect(result.data).toHaveProperty('symbol', 'AAPL')
    expect(result.data).toHaveProperty('sector', 'Technology')
    expect(result.data).toHaveProperty('suggestions')
  })

  it('fetches technicals data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'technicals' })
    expect(result.type).toBe('technicals')
    expect(result.data).toHaveProperty('fiftyDayAverage', 155)
    expect(result.data).toHaveProperty('twoHundredDayAverage', 145)
  })
})
