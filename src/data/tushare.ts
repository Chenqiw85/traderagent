// src/data/tushare.ts
import type { IDataSource } from './IDataSource.js'
import { RateLimitError } from './errors.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type TushareConfig = {
  token: string
  baseURL?: string
}

/**
 * Tushare adapter — calls the Tushare Pro HTTP API for Chinese A-share data.
 * Tushare is a Python library, but exposes an HTTP POST interface at api.tushare.pro.
 */
export class TushareSource implements IDataSource {
  readonly name = 'tushare'
  private token: string
  private baseURL: string

  constructor(config?: TushareConfig) {
    this.token = config?.token ?? process.env['TUSHARE_TOKEN'] ?? ''
    if (!this.token) throw new Error('Missing TUSHARE_TOKEN')
    this.baseURL = config?.baseURL ?? 'https://api.tushare.pro'
    if (!this.baseURL.startsWith('https://')) {
      throw new Error('TushareSource: baseURL must use HTTPS to protect the token')
    }
  }

  private async request(apiName: string, params: Record<string, unknown>, fields?: string): Promise<unknown> {
    const body = {
      api_name: apiName,
      token: this.token,
      params,
      fields: fields ?? '',
    }
    const response = await fetch(this.baseURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined
        throw new RateLimitError('tushare', 429, retryAfterMs)
      }
      throw new Error(`Tushare request failed: ${response.status} ${response.statusText}`)
    }
    const json = await response.json() as { code: number; msg: string; data: unknown }
    if (json.code !== 0) {
      throw new Error(`Tushare API error: ${json.msg}`)
    }
    return json.data
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query
    // Tushare uses ts_code format: 601985.SH (Shanghai), 000001.SZ (Shenzhen)
    const tsCode = ticker.includes('.')
      ? ticker
      : ticker.startsWith('6') ? `${ticker}.SH` : `${ticker}.SZ`

    let data: unknown

    switch (type) {
      case 'ohlcv': {
        const startDate = (query.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
          .toISOString().slice(0, 10).replace(/-/g, '')
        const endDate = (query.to ?? new Date())
          .toISOString().slice(0, 10).replace(/-/g, '')
        data = await this.request('daily', {
          ts_code: tsCode,
          start_date: startDate,
          end_date: endDate,
        })
        break
      }
      case 'fundamentals': {
        const [basic, income, balance] = await Promise.all([
          this.request('daily_basic', { ts_code: tsCode, trade_date: '' }),
          this.request('income', { ts_code: tsCode }),
          this.request('balancesheet', { ts_code: tsCode }),
        ])
        data = { basic, income, balance }
        break
      }
      case 'news': {
        // Tushare provides news via news API
        const startDate = (query.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
          .toISOString().slice(0, 10).replace(/-/g, '')
        const endDate = (query.to ?? new Date())
          .toISOString().slice(0, 10).replace(/-/g, '')
        data = await this.request('news', {
          start_date: startDate,
          end_date: endDate,
          src: 'sina',
        })
        break
      }
      case 'technicals': {
        const startDate = (query.from ?? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000))
          .toISOString().slice(0, 10).replace(/-/g, '')
        const endDate = (query.to ?? new Date())
          .toISOString().slice(0, 10).replace(/-/g, '')
        data = await this.request('daily', {
          ts_code: tsCode,
          start_date: startDate,
          end_date: endDate,
        })
        break
      }
      default:
        throw new Error(`TushareSource does not support data type: ${type}`)
    }

    return { ticker, market, type, data, fetchedAt: new Date() }
  }
}
