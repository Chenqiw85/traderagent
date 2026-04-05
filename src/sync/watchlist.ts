// src/sync/watchlist.ts
import { prisma } from '../db/client.js'
import type { Market } from '../agents/base/types.js'

export async function addTicker(ticker: string, market: Market) {
  return prisma.watchlist.create({
    data: { ticker, market },
  })
}

export async function removeTicker(ticker: string, market: Market) {
  return prisma.watchlist.delete({
    where: { ticker_market: { ticker, market } },
  })
}

export async function listTickers() {
  return prisma.watchlist.findMany({
    where: { active: true },
  })
}
