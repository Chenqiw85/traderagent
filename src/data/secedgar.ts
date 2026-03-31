// src/data/secedgar.ts
import type { IDataSource } from './IDataSource.js'
import { RateLimitError } from './errors.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type SECEdgarConfig = {
  userAgent: string // SEC requires a user-agent header, e.g. "MyApp admin@example.com"
}

/**
 * SEC EDGAR adapter — fetches company filings via the EDGAR full-text search API.
 * Only supports 'fundamentals' data type (SEC filings like 10-K, 10-Q, 8-K).
 */
export class SECEdgarSource implements IDataSource {
  readonly name = 'secedgar'
  private userAgent: string
  private baseURL = 'https://efts.sec.gov/LATEST'

  constructor(config?: SECEdgarConfig) {
    this.userAgent =
      config?.userAgent ?? process.env['SEC_USER_AGENT'] ?? 'TradingAgent research@example.com'
  }

  private async request(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const searchParams = new URLSearchParams(params)
    const url = `${this.baseURL}${path}?${searchParams.toString()}`
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
    })
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : undefined
        throw new RateLimitError('secedgar', 429, retryAfterMs)
      }
      throw new Error(`SEC EDGAR request failed: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    if (query.type !== 'fundamentals') {
      throw new Error(`SECEdgarSource only supports type "fundamentals", got "${query.type}"`)
    }

    const { ticker, market } = query

    // Use the EDGAR full-text search API to find recent filings
    const data = await this.request('/search-index', {
      q: `"${ticker}"`,
      dateRange: 'custom',
      startdt: (query.from ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000))
        .toISOString().slice(0, 10),
      enddt: (query.to ?? new Date()).toISOString().slice(0, 10),
      forms: '10-K,10-Q,8-K',
    })

    return { ticker, market, type: query.type, data, fetchedAt: new Date() }
  }
}
