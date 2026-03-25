// src/data/yfinance.ts
import YahooFinance from 'yahoo-finance2'
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

export class YFinanceSource implements IDataSource {
  readonly name = 'yfinance'
  // yahoo-finance2 types are complex; use any for the instance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private yf: any

  constructor() {
    this.yf = new (YahooFinance as any)()
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type, from, to } = query

    let data: unknown

    switch (type) {
      case 'ohlcv': {
        const period1 = from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        const period2 = to ?? new Date()
        data = await this.yf.historical(ticker, {
          period1: period1.toISOString().slice(0, 10),
          period2: period2.toISOString().slice(0, 10),
        })
        break
      }
      case 'fundamentals': {
        const [quoteSummary, financials] = await Promise.all([
          this.yf.quoteSummary(ticker, {
            modules: ['financialData', 'defaultKeyStatistics', 'earningsHistory'],
          }),
          this.yf.quoteSummary(ticker, {
            modules: ['incomeStatementHistory', 'balanceSheetHistory'],
          }),
        ])
        data = { quoteSummary, financials }
        break
      }
      case 'technicals': {
        const period1 = from ?? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
        const period2 = to ?? new Date()
        const historical = await this.yf.historical(ticker, {
          period1: period1.toISOString().slice(0, 10),
          period2: period2.toISOString().slice(0, 10),
        })
        data = { historical, note: 'raw data for technical analysis' }
        break
      }
      case 'news': {
        const search = await this.yf.search(ticker)
        data = search.news ?? []
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
