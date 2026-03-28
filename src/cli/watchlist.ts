// src/cli/watchlist.ts
import { addTicker, removeTicker, listTickers } from '../sync/watchlist.js'
import type { Market } from '../agents/base/types.js'

async function main() {
  const [command, ...args] = process.argv.slice(2)

  switch (command) {
    case 'add': {
      const [ticker, market = 'US'] = args
      if (!ticker) {
        console.error('Usage: watchlist add <TICKER> [US|CN|HK]')
        process.exit(1)
      }
      const entry = await addTicker(ticker.toUpperCase(), market.toUpperCase() as Market)
      console.log(`Added ${entry.ticker} (${entry.market}) to watchlist`)
      break
    }
    case 'remove': {
      const [ticker] = args
      if (!ticker) {
        console.error('Usage: watchlist remove <TICKER>')
        process.exit(1)
      }
      await removeTicker(ticker.toUpperCase())
      console.log(`Removed ${ticker.toUpperCase()} from watchlist`)
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
