import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, LiveMarketSnapshot, TradingReport } from '../base/types.js'
import type { ILiveMarketDataSource } from '../../data/ILiveMarketDataSource.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('realtime-quote-fetcher')

type RealtimeQuoteFetcherConfig = {
  liveMarketDataSource: ILiveMarketDataSource
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasUsableLiveQuote(snapshot: LiveMarketSnapshot): boolean {
  return (
    isFiniteNumber(snapshot.regularMarketPrice) ||
    isFiniteNumber(snapshot.postMarketPrice) ||
    isFiniteNumber(snapshot.preMarketPrice) ||
    isFiniteNumber(snapshot.bid) ||
    isFiniteNumber(snapshot.ask)
  )
}

/**
 * Optional pipeline stage that overlays a single live market snapshot.
 * If the live source fails, the stage logs and returns the original report unchanged.
 */
export class RealtimeQuoteFetcher implements IAgent {
  readonly name = 'realtimeQuoteFetcher'
  readonly role: AgentRole = 'data'

  private liveMarketDataSource: ILiveMarketDataSource

  constructor(config: RealtimeQuoteFetcherConfig) {
    this.liveMarketDataSource = config.liveMarketDataSource
  }

  async run(report: TradingReport): Promise<TradingReport> {
    try {
      const liveMarketSnapshot = await this.liveMarketDataSource.fetchLiveSnapshot({
        ticker: report.ticker,
        market: report.market,
      })

      if (!hasUsableLiveQuote(liveMarketSnapshot)) {
        log.warn(
          {
            ticker: report.ticker,
            market: report.market,
            sourceChain: this.liveMarketDataSource.name,
          },
          'Live source resolved without usable quote payload, skipping overlay',
        )
        return report
      }

      return {
        ...report,
        liveMarketSnapshot,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(
        {
          ticker: report.ticker,
          market: report.market,
          sourceChain: this.liveMarketDataSource.name,
          error: message,
        },
        `Live market snapshot fetch failed from ${this.liveMarketDataSource.name}, continuing without overlay`,
      )
      return report
    }
  }
}
