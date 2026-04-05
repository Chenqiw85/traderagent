// src/cli/sync.ts
import { DataSyncService } from '../sync/DataSyncService.js'
import { YFinanceSource } from '../data/yfinance.js'
import { FinnhubSource } from '../data/finnhub.js'
import type { Market } from '../agents/base/types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('cli:sync')

async function main() {
  const args = process.argv.slice(2)
  const tickerIdx = args.indexOf('--ticker')

  const sources = []
  if (process.env['FINNHUB_API_KEY']) {
    sources.push(new FinnhubSource())
  }
  sources.push(new YFinanceSource())

  const service = new DataSyncService(sources)

  if (tickerIdx !== -1 && args[tickerIdx + 1]) {
    const ticker = args[tickerIdx + 1]
    const marketRaw = args[tickerIdx + 2] ?? 'US'
    const VALID_MARKETS = new Set(['US', 'CN', 'HK'])
    if (!VALID_MARKETS.has(marketRaw.toUpperCase())) {
      log.error(`Invalid market: "${marketRaw}". Must be one of: US, CN, HK`)
      process.exit(1)
    }
    const market = marketRaw.toUpperCase() as Market
    log.info({ ticker, market }, 'Syncing single ticker')
    await service.syncTicker(ticker, market)
  } else {
    log.info('Syncing all watchlist tickers')
    await service.syncAll()
  }

  log.info('Done')
  process.exit(0)
}

main().catch((err) => {
  log.error({ error: err }, 'Sync failed')
  process.exit(1)
})
