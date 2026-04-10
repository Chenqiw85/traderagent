import YahooFinance from 'yahoo-finance2'
import type { LiveMarketSnapshot } from '../agents/base/types.js'
import type { ILiveMarketDataSource, LiveMarketQuery } from './ILiveMarketDataSource.js'

type YahooLiveQuote = {
  currency?: string
  marketState?: string
  regularMarketPrice?: number
  regularMarketChange?: number
  regularMarketChangePercent?: number
  regularMarketTime?: number | string | Date
  postMarketPrice?: number
  postMarketChange?: number
  postMarketChangePercent?: number
  postMarketTime?: number | string | Date
  preMarketPrice?: number
  preMarketChange?: number
  preMarketChangePercent?: number
  preMarketTime?: number | string | Date
  bid?: number
  ask?: number
  regularMarketDayHigh?: number
  regularMarketDayLow?: number
  fiftyTwoWeekHigh?: number
  fiftyTwoWeekLow?: number
  regularMarketVolume?: number
}

type YahooFinanceClient = {
  quote(symbol: string): Promise<YahooLiveQuote>
}

type YahooFinanceCtor = new (options: { suppressNotices?: string[] }) => YahooFinanceClient

function toDate(value: number | string | Date | undefined): Date | undefined {
  if (value == null) return undefined
  if (value instanceof Date) return value
  if (typeof value === 'number') {
    return new Date(value < 1e12 ? value * 1000 : value)
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export class YahooLiveMarketSource implements ILiveMarketDataSource {
  readonly name = 'yahoo-live'
  private yf: YahooFinanceClient

  constructor() {
    const YahooFinanceClientCtor = YahooFinance as unknown as YahooFinanceCtor
    this.yf = new YahooFinanceClientCtor({
      suppressNotices: ['yahooSurvey', 'ripHistorical'],
    })
  }

  private resolveYahooTicker(ticker: string, market: LiveMarketQuery['market']): string {
    if (market === 'HK') {
      return ticker.includes('.') ? `${ticker.split('.')[0]}.HK` : `${ticker}.HK`
    }

    if (market === 'CN') {
      const [baseTicker, suffix] = ticker.split('.')
      const normalizedSuffix = suffix?.toUpperCase()

      if (normalizedSuffix === 'SZ') return `${baseTicker}.SZ`
      if (normalizedSuffix === 'SS' || normalizedSuffix === 'SH') return `${baseTicker}.SS`

      return baseTicker.startsWith('6') ? `${baseTicker}.SS` : `${baseTicker}.SZ`
    }

    if (market === 'US' && ticker.includes('.')) {
      return ticker.replace('.', '-')
    }

    if (ticker.includes('.')) return ticker
    return ticker
  }

  async fetchLiveSnapshot(query: LiveMarketQuery): Promise<LiveMarketSnapshot> {
    const yahooTicker = this.resolveYahooTicker(query.ticker, query.market)
    const quote = await this.yf.quote(yahooTicker)

    return {
      source: this.name,
      fetchedAt: new Date(),
      marketState: quote.marketState,
      currency: quote.currency,
      regularMarketPrice: quote.regularMarketPrice,
      regularMarketChange: quote.regularMarketChange,
      regularMarketChangePercent: quote.regularMarketChangePercent,
      regularMarketTime: toDate(quote.regularMarketTime),
      postMarketPrice: quote.postMarketPrice,
      postMarketChange: quote.postMarketChange,
      postMarketChangePercent: quote.postMarketChangePercent,
      postMarketTime: toDate(quote.postMarketTime),
      preMarketPrice: quote.preMarketPrice,
      preMarketChange: quote.preMarketChange,
      preMarketChangePercent: quote.preMarketChangePercent,
      preMarketTime: toDate(quote.preMarketTime),
      bid: quote.bid,
      ask: quote.ask,
      dayHigh: quote.regularMarketDayHigh,
      dayLow: quote.regularMarketDayLow,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
      volume: quote.regularMarketVolume,
    }
  }
}
