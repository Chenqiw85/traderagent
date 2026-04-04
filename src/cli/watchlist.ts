// src/cli/watchlist.ts
import { addTicker, removeTicker, listTickers } from '../sync/watchlist.js'
import { validateTicker, validateMarket } from '../utils/validation.js'

async function main() {
  const [command, ...args] = process.argv.slice(2)

  switch (command) {
    case 'add': {
      const [tickerRaw, marketRaw = 'US'] = args
      if (!tickerRaw) {
        console.error('Usage: watchlist add <TICKER> [US|CN|HK]')
        process.exit(1)
      }
      const ticker = validateTicker(tickerRaw)
      const market = validateMarket(marketRaw)
      const entry = await addTicker(ticker, market)
      console.log(`Added ${entry.ticker} (${entry.market}) to watchlist`)
      break
    }
    case 'remove': {
      const [tickerRaw] = args
      if (!tickerRaw) {
        console.error('Usage: watchlist remove <TICKER>')
        process.exit(1)
      }
      const ticker = validateTicker(tickerRaw)
      await removeTicker(ticker)
      console.log(`Removed ${ticker} from watchlist`)
      break
    }
    case 'list': {
      const entries = await listTickers()
      if (entries.length === 0) {
        console.log('Watchlist is empty')
      } else {
        console.log('Active watchlist:')
        for (const e of entries) {
          console.log(`  ${e.ticker} (${e.market})`)
        }
      }
      break
    }
    default:
      console.error('Usage: watchlist <add|remove|list> [args]')
      process.exit(1)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('Watchlist command failed:', err)
  process.exit(1)
})
