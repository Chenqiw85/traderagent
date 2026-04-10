import { describe, it, expect, vi, beforeEach } from 'vitest'
import { YahooLiveMarketSource } from '../../src/data/YahooLiveMarketSource.js'

const { mockQuote } = vi.hoisted(() => {
  const mockQuote = vi.fn().mockResolvedValue({
    currency: 'USD',
    marketState: 'POSTPOST',
    regularMarketPrice: 150,
    regularMarketChange: 1.2,
    regularMarketChangePercent: 0.8,
    regularMarketTime: 1712606400,
    postMarketPrice: 152.3,
    postMarketChange: 2.3,
    postMarketChangePercent: 1.53,
    postMarketTime: 1712610000,
    preMarketPrice: 148.4,
    preMarketChange: -1.6,
    preMarketChangePercent: -1.07,
    preMarketTime: 1712588400,
    bid: 152.25,
    ask: 152.35,
    regularMarketDayHigh: 153,
    regularMarketDayLow: 149,
    fiftyTwoWeekHigh: 200,
    fiftyTwoWeekLow: 120,
    regularMarketVolume: 1250000,
  })

  return { mockQuote }
})

vi.mock('yahoo-finance2', () => ({
  default: vi.fn().mockImplementation(() => ({
    quote: mockQuote,
  })),
}))

describe('YahooLiveMarketSource', () => {
  let source: YahooLiveMarketSource

  beforeEach(() => {
    source = new YahooLiveMarketSource()
    mockQuote.mockClear()
  })

  it('normalizes a live quote payload into a live market snapshot', async () => {
    const snapshot = await source.fetchLiveSnapshot({ ticker: 'AAPL', market: 'US' })

    expect(snapshot.source).toBe('yahoo-live')
    expect(snapshot.marketState).toBe('POSTPOST')
    expect(snapshot.regularMarketPrice).toBe(150)
    expect(snapshot.postMarketPrice).toBe(152.3)
    expect(snapshot.bid).toBe(152.25)
    expect(snapshot.dayHigh).toBe(153)
    expect(snapshot.volume).toBe(1250000)
    expect(snapshot.fetchedAt).toBeInstanceOf(Date)
    expect(snapshot.regularMarketTime).toEqual(new Date('2024-04-08T20:00:00.000Z'))
    expect(snapshot.postMarketTime).toEqual(new Date('2024-04-08T21:00:00.000Z'))
    expect(snapshot.preMarketTime).toEqual(new Date('2024-04-08T15:00:00.000Z'))
  })

  it('calls quote with the US ticker unchanged and resolves HK suffixes', async () => {
    await source.fetchLiveSnapshot({ ticker: 'AAPL', market: 'US' })
    await source.fetchLiveSnapshot({ ticker: '0700', market: 'HK' })

    expect(mockQuote).toHaveBeenNthCalledWith(1, 'AAPL')
    expect(mockQuote).toHaveBeenNthCalledWith(2, '0700.HK')
  })

  it('normalizes US share-class tickers to Yahoo hyphenated symbols', async () => {
    await source.fetchLiveSnapshot({ ticker: 'BRK.B', market: 'US' })

    expect(mockQuote).toHaveBeenCalledWith('BRK-B')
  })

  it('normalizes CN dotted tickers to Yahoo suffix conventions', async () => {
    await source.fetchLiveSnapshot({ ticker: '600000.SH', market: 'CN' })
    await source.fetchLiveSnapshot({ ticker: '000001.SZ', market: 'CN' })

    expect(mockQuote).toHaveBeenNthCalledWith(1, '600000.SS')
    expect(mockQuote).toHaveBeenNthCalledWith(2, '000001.SZ')
  })
})
