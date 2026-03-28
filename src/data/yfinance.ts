// src/data/yfinance.ts
import YahooFinance from 'yahoo-finance2'
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

export class YFinanceSource implements IDataSource {
  readonly name = 'yfinance'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private yf: any

  constructor() {
    this.yf = new (YahooFinance as any)({
      suppressNotices: ['yahooSurvey', 'ripHistorical'],
    })
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query

    let data: unknown

    switch (type) {
      case 'ohlcv': {
        // Fetch 90 days of daily OHLCV bars
        const period1 = query.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        const period2 = query.to ?? new Date()
        data = await this.yf.chart(ticker, {
          period1: period1.toISOString().slice(0, 10),
          period2: period2.toISOString().slice(0, 10),
          interval: '1d',
        })
        break
      }
      case 'technicals': {
        // Fetch 180 days for longer-window indicators (SMA200, etc.)
        const period1 = query.from ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        const period2 = query.to ?? new Date()
        data = await this.yf.chart(ticker, {
          period1: period1.toISOString().slice(0, 10),
          period2: period2.toISOString().slice(0, 10),
          interval: '1d',
        })
        break
      }
      case 'fundamentals': {
        const [quoteSummary, quote] = await Promise.all([
          this.yf.quoteSummary(ticker, {
            modules: ['financialData', 'defaultKeyStatistics', 'earningsHistory', 'incomeStatementHistory', 'balanceSheetHistory'],
          }),
          this.yf.quote(ticker),
        ])
        data = { quoteSummary, quote }
        break
      }
      case 'news': {
        const [searchResult, quote] = await Promise.all([
          this.yf.search(ticker),
          this.yf.quote(ticker),
        ])
        data = {
          news: searchResult.news ?? [],
          symbol: quote.symbol,
          shortName: quote.shortName,
          sector: quote.sector,
          industry: quote.industry,
          analystRating: quote.averageAnalystRating,
          analystTargetPrice: quote.targetMeanPrice,
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
