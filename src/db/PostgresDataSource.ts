// src/db/PostgresDataSource.ts
import type { IDataSource } from '../data/IDataSource.js'
import type { DataQuery, DataResult, DataType, Market } from '../agents/base/types.js'
import { prisma } from './client.js'

const FRESHNESS_HOURS: Record<DataType, number> = {
  ohlcv: 24,
  fundamentals: 24,
  technicals: 24,
  news: 24,
}

export class PostgresDataSource implements IDataSource {
  readonly name = 'postgres'

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query

    switch (type) {
      case 'ohlcv':
        return this.fetchOhlcv(ticker, market, query.from, query.to)
      case 'fundamentals':
        return this.fetchFundamentals(ticker, market)
      case 'news':
        return this.fetchNews(ticker, market, query.from, query.to)
      case 'technicals':
        return this.fetchTechnicals(ticker, market)
      default:
        throw new Error(`PostgresDataSource does not support data type: ${type}`)
    }
  }

  private async fetchOhlcv(
    ticker: string,
    market: Market,
    from?: Date,
    to?: Date,
  ): Promise<DataResult> {
    const period1 = from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const period2 = to ?? new Date()

    const rows = await prisma.ohlcv.findMany({
      where: {
        ticker,
        market,
        date: { gte: period1, lte: period2 },
      },
      orderBy: { date: 'asc' },
    })

    if (rows.length === 0) {
      throw new Error(`No ohlcv data for ${ticker} in postgres`)
    }

    return { ticker, market, type: 'ohlcv', data: rows, fetchedAt: new Date() }
  }

  private async fetchFundamentals(ticker: string, market: Market): Promise<DataResult> {
    const record = await prisma.fundamentals.findFirst({
      where: { ticker, market },
      orderBy: { fetchedAt: 'desc' },
    })

    if (!record) {
      throw new Error(`No fundamentals data for ${ticker} in postgres`)
    }

    const ageHours = (Date.now() - record.fetchedAt.getTime()) / (1000 * 60 * 60)
    if (ageHours > FRESHNESS_HOURS.fundamentals) {
      throw new Error(`Stale fundamentals data for ${ticker} (${Math.round(ageHours)}h old)`)
    }

    return { ticker, market, type: 'fundamentals', data: record.data, fetchedAt: record.fetchedAt }
  }

  private async fetchNews(
    ticker: string,
    market: Market,
    from?: Date,
    to?: Date,
  ): Promise<DataResult> {
    const period1 = from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const period2 = to ?? new Date()

    const articles = await prisma.news.findMany({
      where: {
        ticker,
        market,
        publishedAt: { gte: period1, lte: period2 },
      },
      orderBy: { publishedAt: 'desc' },
    })

    if (articles.length === 0) {
      throw new Error(`No news data for ${ticker} in postgres`)
    }

    return { ticker, market, type: 'news', data: articles, fetchedAt: new Date() }
  }

  private async fetchTechnicals(ticker: string, market: Market): Promise<DataResult> {
    const record = await prisma.technicals.findFirst({
      where: { ticker, market },
      orderBy: { computedAt: 'desc' },
    })

    if (!record) {
      throw new Error(`No technicals data for ${ticker} in postgres`)
    }

    const ageHours = (Date.now() - record.computedAt.getTime()) / (1000 * 60 * 60)
    if (ageHours > FRESHNESS_HOURS.technicals) {
      throw new Error(`Stale technicals data for ${ticker} (${Math.round(ageHours)}h old)`)
    }

    return { ticker, market, type: 'technicals', data: record.indicators, fetchedAt: record.computedAt }
  }

  async writeBack(
    ticker: string,
    market: string,
    type: DataType,
    data: unknown,
    source: string,
  ): Promise<void> {
    switch (type) {
      case 'ohlcv': {
        const bars = data as Array<{
          date: Date
          open: number
          high: number
          low: number
          close: number
          volume: number
        }>
        await prisma.ohlcv.createMany({
          data: bars.map((bar) => ({
            ticker,
            market,
            date: bar.date,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: BigInt(bar.volume),
            source,
          })),
          skipDuplicates: true,
        })
        break
      }
      case 'fundamentals': {
        await prisma.fundamentals.create({
          data: { ticker, market, data: data as object, source },
        })
        break
      }
      case 'news': {
        const articles = data as Array<{
          title: string
          url: string
          publishedAt: Date
          data?: object
        }>
        await prisma.news.createMany({
          data: articles.map((a) => ({
            ticker,
            market,
            title: a.title,
            url: a.url,
            source,
            publishedAt: a.publishedAt,
            data: a.data ?? undefined,
          })),
          skipDuplicates: true,
        })
        break
      }
      case 'technicals': {
        // Technicals are computed by TechnicalAnalyzer, not written back from API
        break
      }
    }
  }
}
