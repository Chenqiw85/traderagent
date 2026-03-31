// src/data/akshare.ts
import type { IDataSource } from './IDataSource.js'
import { RateLimitError } from './errors.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type AkShareConfig = {
  baseURL: string // URL of the AkShare HTTP microservice
}

/**
 * AkShare adapter — calls a lightweight HTTP microservice wrapping the AkShare Python library.
 * Expected service endpoints:
 *   POST /api/stock_zh_a_hist       (CN A-share OHLCV)
 *   POST /api/stock_hk_hist         (HK OHLCV)
 *   POST /api/stock_news_em         (news)
 *   POST /api/stock_financial_analysis_indicator (fundamentals)
 *
 * Each endpoint accepts JSON { symbol, start_date, end_date, ... }
 */
export class AkShareSource implements IDataSource {
  readonly name = 'akshare'
  private baseURL: string

  constructor(config?: AkShareConfig) {
    this.baseURL = config?.baseURL ?? process.env['AKSHARE_BASE_URL'] ?? 'http://localhost:8080'
  }

  private async request(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
    const url = `${this.baseURL}/api/${endpoint}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined
        throw new RateLimitError('akshare', 429, retryAfterMs)
      }
      throw new Error(`AkShare request failed: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  private formatDate(d: Date): string {
    return d.toISOString().slice(0, 10).replace(/-/g, '')
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query
    let data: unknown

    const startDate = this.formatDate(query.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
    const endDate = this.formatDate(query.to ?? new Date())

    switch (type) {
      case 'ohlcv': {
        const endpoint = market === 'HK' ? 'stock_hk_hist' : 'stock_zh_a_hist'
        data = await this.request(endpoint, {
          symbol: ticker,
          start_date: startDate,
          end_date: endDate,
          adjust: 'qfq',
        })
        break
      }
      case 'fundamentals': {
        data = await this.request('stock_financial_analysis_indicator', {
          symbol: ticker,
        })
        break
      }
      case 'news': {
        data = await this.request('stock_news_em', { symbol: ticker })
        break
      }
      case 'technicals': {
        const endpoint = market === 'HK' ? 'stock_hk_hist' : 'stock_zh_a_hist'
        data = await this.request(endpoint, {
          symbol: ticker,
          start_date: this.formatDate(query.from ?? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)),
          end_date: endDate,
          adjust: 'qfq',
        })
        break
      }
      default:
        throw new Error(`AkShareSource does not support data type: ${type}`)
    }

    return { ticker, market, type, data, fetchedAt: new Date() }
  }
}
