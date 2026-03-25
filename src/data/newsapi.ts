// src/data/newsapi.ts
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type NewsAPIConfig = {
  apiKey: string
}

/**
 * NewsAPI adapter — fetches news articles via the NewsAPI.org HTTP endpoint.
 * Only supports the 'news' data type.
 */
export class NewsAPISource implements IDataSource {
  readonly name = 'newsapi'
  private apiKey: string

  constructor(config?: NewsAPIConfig) {
    this.apiKey = config?.apiKey ?? process.env['NEWSAPI_API_KEY'] ?? ''
    if (!this.apiKey) throw new Error('Missing NEWSAPI_API_KEY')
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    if (query.type !== 'news') {
      throw new Error(`NewsAPISource only supports type "news", got "${query.type}"`)
    }

    const from = query.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const to = query.to ?? new Date()
    const fromStr = from.toISOString().slice(0, 10)
    const toStr = to.toISOString().slice(0, 10)

    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query.ticker)}&from=${fromStr}&to=${toStr}&sortBy=relevancy&pageSize=20&apiKey=${this.apiKey}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`NewsAPI request failed: ${response.status} ${response.statusText}`)
    }
    const data = await response.json()

    return {
      ticker: query.ticker,
      market: query.market,
      type: query.type,
      data: data.articles ?? [],
      fetchedAt: new Date(),
    }
  }
}
