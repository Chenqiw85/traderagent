import type { Market } from '../agents/base/types.js'

const TICKER_PATTERN = /^[A-Z0-9.\-^]{1,20}$/
const VALID_MARKETS = new Set<string>(['US', 'CN', 'HK'])

export function validateTicker(ticker: string): string {
  const upper = ticker.trim().toUpperCase()
  if (!TICKER_PATTERN.test(upper)) {
    throw new Error(`Invalid ticker format: "${ticker}". Must be 1-20 alphanumeric characters, dots, or hyphens.`)
  }
  return upper
}

export function validateMarket(market: string): Market {
  const upper = market.trim().toUpperCase()
  if (!VALID_MARKETS.has(upper)) {
    throw new Error(`Invalid market: "${market}". Must be one of: US, CN, HK`)
  }
  return upper as Market
}
