import type { Market, LiveMarketSnapshot } from '../agents/base/types.js'

export type LiveMarketQuery = {
  ticker: string
  market: Market
}

export interface ILiveMarketDataSource {
  readonly name: string
  fetchLiveSnapshot(query: LiveMarketQuery): Promise<LiveMarketSnapshot>
}
