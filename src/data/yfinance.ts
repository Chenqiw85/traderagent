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

  /**
   * Extract usable data from a FailedYahooValidationError.
   * The library attaches a partially-coerced `result` to the error;
   * OHLCV quotes inside are typically valid even when meta fields are null.
   */
  private extractPartialResult(error: unknown): unknown {
    if (
      error instanceof Error &&
      error.name === 'FailedYahooValidationError' &&
      'result' in error
    ) {
      return (error as Error & { result: unknown }).result
    }
    throw error
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query

    let data: unknown

    switch (type) {
      case 'ohlcv': {
        const period1 = query.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        const period2 = query.to ?? new Date()
        const chartOpts = {
          period1: period1.toISOString().slice(0, 10),
          period2: period2.toISOString().slice(0, 10),
          interval: '1d',
        }
        try {
          data = await this.yf.chart(ticker, chartOpts)
        } catch (error) {
          data = this.extractPartialResult(error)
        }
        break
      }
      case 'technicals': {
        const period1 = query.from ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        const period2 = query.to ?? new Date()
        const chartOpts = {
          period1: period1.toISOString().slice(0, 10),
          period2: period2.toISOString().slice(0, 10),
          interval: '1d',
        }
        try {
          data = await this.yf.chart(ticker, chartOpts)
        } catch (error) {
          data = this.extractPartialResult(error)
        }
        break
      }
      case 'fundamentals': {
        const [quoteSummary, quote] = await Promise.all([
          this.yf.quoteSummary(ticker, {
            modules: ['financialData', 'defaultKeyStatistics', 'earningsHistory', 'incomeStatementHistory', 'balanceSheetHistory'],
          }),
          this.yf.quote(ticker),
        ])
        // Keep only entries from the past year to reduce token usage
        const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        const filterByDate = (arr: Record<string, unknown>[] | undefined) =>
          (arr ?? []).filter((row) => {
            const d = row.endDate as Date | string | undefined
            return d != null && new Date(d as string) >= oneYearAgo
          })
        const qs = quoteSummary as Record<string, unknown>
        if (qs.earningsHistory && typeof qs.earningsHistory === 'object') {
          const eh = qs.earningsHistory as Record<string, unknown>
          eh.history = filterByDate(eh.history as Record<string, unknown>[] | undefined)
        }
        if (qs.incomeStatementHistory && typeof qs.incomeStatementHistory === 'object') {
          const ish = qs.incomeStatementHistory as Record<string, unknown>
          ish.incomeStatementHistory = filterByDate(ish.incomeStatementHistory as Record<string, unknown>[] | undefined)
        }
        if (qs.balanceSheetHistory && typeof qs.balanceSheetHistory === 'object') {
          const bsh = qs.balanceSheetHistory as Record<string, unknown>
          bsh.balanceSheetStatements = filterByDate(bsh.balanceSheetStatements as Record<string, unknown>[] | undefined)
        }
        data = { quoteSummary, quote }
        break
      }
      case 'news': {
        const [searchResult, quote] = await Promise.all([
          this.yf.search(ticker),
          this.yf.quote(ticker),
        ])
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        const recentNews = (searchResult.news ?? []).filter((n: Record<string, unknown>) => {
          const ts = n.providerPublishTime as number | undefined
          return ts != null && ts * 1000 >= oneWeekAgo
        })
        data = {
          news: recentNews,
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
