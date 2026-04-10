import type { LiveMarketSnapshot } from '../agents/base/types.js'
import type { ILiveMarketDataSource, LiveMarketQuery } from './ILiveMarketDataSource.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('fallback-live-market')

export class FallbackLiveMarketDataSource implements ILiveMarketDataSource {
  readonly name: string
  private sources: ILiveMarketDataSource[]

  constructor(name: string, sources: ILiveMarketDataSource[]) {
    this.name = name
    this.sources = sources
  }

  async fetchLiveSnapshot(query: LiveMarketQuery): Promise<LiveMarketSnapshot> {
    if (this.sources.length === 0) {
      throw new Error(`No live market sources configured for ${query.ticker}`)
    }

    const errors: { source: string; error: string }[] = []

    for (const source of this.sources) {
      try {
        return await source.fetchLiveSnapshot(query)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn(
          { source: source.name, ticker: query.ticker, market: query.market, error: message },
          `${this.name} source failed`,
        )
        errors.push({ source: source.name, error: message })
      }
    }

    const details = errors.map((entry) => `${entry.source}: ${entry.error}`).join(', ')
    throw new Error(`All live market sources failed for ${query.ticker}: ${details}`)
  }
}
