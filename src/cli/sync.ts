// src/cli/sync.ts
import { DataSyncService } from '../sync/DataSyncService.js'
import { YFinanceSource } from '../data/yfinance.js'
import { FinnhubSource } from '../data/finnhub.js'
import type { Market } from '../agents/base/types.js'

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
    const market = (args[tickerIdx + 2] ?? 'US') as Market
    console.log(`Syncing single ticker: ${ticker} (${market})`)
    await service.syncTicker(ticker, market)
  } else {
    console.log('Syncing all watchlist tickers...')
    await service.syncAll()
  }

  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Sync failed:', err)
  process.exit(1)
})
