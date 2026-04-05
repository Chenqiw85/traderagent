// src/cli/watchlist.ts
import { addTicker, removeTicker, listTickers } from '../sync/watchlist.js'
import { validateTicker, validateMarket } from '../utils/validation.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('cli:watchlist')

async function main() {
  const [command, ...args] = process.argv.slice(2)

  switch (command) {
    case 'add': {
      const [tickerRaw, marketRaw = 'US'] = args
      if (!tickerRaw) {
        log.error('Usage: watchlist add <TICKER> [US|CN|HK]')
        process.exit(1)
      }
      const ticker = validateTicker(tickerRaw)
      const market = validateMarket(marketRaw)
      const entry = await addTicker(ticker, market)
      log.info({ ticker: entry.ticker, market: entry.market }, 'Added to watchlist')
      break
    }
    case 'remove': {
      const [tickerRaw, marketRaw = 'US'] = args
      if (!tickerRaw) {
        log.error('Usage: watchlist remove <TICKER> [US|CN|HK]')
        process.exit(1)
      }
      const ticker = validateTicker(tickerRaw)
      const market = validateMarket(marketRaw)
      await removeTicker(ticker, market)
      log.info({ ticker, market }, 'Removed from watchlist')
      break
    }
    case 'list': {
      const entries = await listTickers()
      if (entries.length === 0) {
        log.info('Watchlist is empty')
      } else {
        const list = entries.map((e) => `  ${e.ticker} (${e.market})`).join('\n')
        log.info(`Active watchlist:\n${list}`)
      }
      break
    }
    default:
      log.error('Usage: watchlist <add|remove|list> [args]')
      process.exit(1)
  }

  process.exit(0)
}

main().catch((err) => {
  log.error({ error: err }, 'Watchlist command failed')
  process.exit(1)
})
