// src/data/finnhub.ts
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type FinnhubConfig = {
  apiKey: string
}

/**
 * Finnhub adapter — calls the Finnhub REST API for US equities data.
 * Supports: news, fundamentals, technicals.
 */
export class FinnhubSource implements IDataSource {
  readonly name = 'finnhub'
  private apiKey: string
  private baseURL = 'https://finnhub.io/api/v1'

  constructor(config?: FinnhubConfig) {
    this.apiKey = config?.apiKey ?? process.env['FINNHUB_API_KEY'] ?? ''
    if (!this.apiKey) throw new Error('Missing FINNHUB_API_KEY')
  }

  private async request(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const searchParams = new URLSearchParams({ ...params, token: this.apiKey })
    const url = `${this.baseURL}${path}?${searchParams.toString()}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Finnhub request failed: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query
    let data: unknown

    switch (type) {
      case 'news': {
        const from = (query.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
          .toISOString().slice(0, 10)
        const to = (query.to ?? new Date()).toISOString().slice(0, 10)
        data = await this.request('/company-news', { symbol: ticker, from, to })
        break
      }
      case 'fundamentals': {
        const [profile, financials, metrics] = await Promise.all([
          this.request('/stock/profile2', { symbol: ticker }),
          this.request('/stock/financials-reported', { symbol: ticker }),
          this.request('/stock/metric', { symbol: ticker, metric: 'all' }),
        ])
        data = { profile, financials, metrics }
        break
      }
      case 'technicals': {
        const to = Math.floor((query.to ?? new Date()).getTime() / 1000)
        const from = Math.floor(
          (query.from ?? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)).getTime() / 1000,
        )
        data = await this.request('/stock/candle', {
          symbol: ticker,
          resolution: 'D',
          from: String(from),
          to: String(to),
        })
        break
      }
      case 'ohlcv': {
        const to = Math.floor((query.to ?? new Date()).getTime() / 1000)
        const from = Math.floor(
          (query.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)).getTime() / 1000,
        )
        data = await this.request('/stock/candle', {
          symbol: ticker,
          resolution: 'D',
          from: String(from),
          to: String(to),
        })
        break
      }
      default:
        throw new Error(`FinnhubSource does not support data type: ${type}`)
    }

    return { ticker, market, type, data, fetchedAt: new Date() }
  }
}
