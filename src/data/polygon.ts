// src/data/polygon.ts
import { restClient } from '@polygon.io/client-js'
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type PolygonConfig = {
  apiKey: string
}

export class PolygonSource implements IDataSource {
  readonly name = 'polygon'
  private client: ReturnType<typeof restClient>

  constructor(config?: PolygonConfig) {
    const apiKey = config?.apiKey ?? process.env['POLYGON_API_KEY']
    if (!apiKey) throw new Error('Missing POLYGON_API_KEY')
    this.client = restClient(apiKey)
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type, from, to } = query

    let data: unknown

    switch (type) {
      case 'ohlcv': {
        const fromDate = (from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
          .toISOString().slice(0, 10)
        const toDate = (to ?? new Date()).toISOString().slice(0, 10)
        data = await this.client.stocks.aggregates(
          ticker, 1, 'day', fromDate, toDate,
        )
        break
      }
      case 'news': {
        data = await this.client.reference.tickerNews({ ticker, limit: 20 })
        break
      }
      case 'fundamentals': {
        data = await this.client.reference.tickerDetails(ticker)
        break
      }
      case 'technicals': {
        // Polygon provides SMA, EMA, RSI, MACD via technical indicators endpoint
        const fromDate = (from ?? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000))
          .toISOString().slice(0, 10)
        const toDate = (to ?? new Date()).toISOString().slice(0, 10)
        const aggs = await this.client.stocks.aggregates(
          ticker, 1, 'day', fromDate, toDate,
        )
        data = { aggregates: aggs, note: 'raw data for technical analysis' }
        break
      }
      default:
        throw new Error(`PolygonSource does not support data type: ${type}`)
    }

    return { ticker, market, type, data, fetchedAt: new Date() }
  }
}
