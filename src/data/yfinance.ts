// src/data/yfinance.ts
import YahooFinance from 'yahoo-finance2'
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

export class YFinanceSource implements IDataSource {
  readonly name = 'yfinance'
  // yahoo-finance2 v2.14 exports a class via createYahooFinance; only quote() and autoc() are available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private yf: any

  constructor() {
    this.yf = new (YahooFinance as any)()
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query

    let data: unknown

    switch (type) {
      case 'ohlcv':
      case 'technicals': {
        // quote() returns regularMarketPrice, Open, High, Low, Volume, 52-week range, etc.
        const q = await this.yf.quote(ticker)
        data = {
          symbol: q.symbol,
          price: q.regularMarketPrice,
          open: q.regularMarketOpen,
          high: q.regularMarketDayHigh,
          low: q.regularMarketDayLow,
          volume: q.regularMarketVolume,
          previousClose: q.regularMarketPreviousClose,
          change: q.regularMarketChange,
          changePercent: q.regularMarketChangePercent,
          fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: q.fiftyTwoWeekLow,
          fiftyDayAverage: q.fiftyDayAverage,
          twoHundredDayAverage: q.twoHundredDayAverage,
          averageVolume: q.averageDailyVolume3Month,
        }
        break
      }
      case 'fundamentals': {
        const q = await this.yf.quote(ticker)
        data = {
          symbol: q.symbol,
          marketCap: q.marketCap,
          trailingPE: q.trailingPE,
          forwardPE: q.forwardPE,
          priceToBook: q.priceToBook,
          trailingEps: q.epsTrailingTwelveMonths,
          forwardEps: q.epsForward,
          dividendYield: q.trailingAnnualDividendYield,
          earningsTimestamp: q.earningsTimestamp,
          analystTargetPrice: q.targetMeanPrice,
          numberOfAnalystOpinions: q.numberOfAnalystOpinions,
          recommendationMean: q.averageAnalystRating,
          enterpriseValue: q.enterpriseValue,
          priceToSalesTrailing12Months: q.priceToSalesTrailing12Months,
        }
        break
      }
      case 'news': {
        // autoc() returns autocomplete suggestions; use quote for basic info since no news API in this version
        const [q, autoc] = await Promise.all([
          this.yf.quote(ticker),
          this.yf.autoc(ticker).catch(() => ({ Result: [] })),
        ])
        data = {
          symbol: q.symbol,
          shortName: q.shortName,
          longName: q.longName,
          sector: q.sector,
          industry: q.industry,
          exchange: q.exchange,
          quoteType: q.quoteType,
          analystRating: q.averageAnalystRating,
          analystTargetPrice: q.targetMeanPrice,
          // autoc results may include news titles in some responses
          suggestions: autoc?.Result ?? [],
          note: 'News feed unavailable in yahoo-finance2 v2.14; using quote + autoc data instead.',
        }
        break
      }
      default:
        throw new Error(`YFinanceSource does not support data type: ${type}`)
    }

    return {
      ticker,
      market,
      type,
      data,
      fetchedAt: new Date(),
    }
  }
}
