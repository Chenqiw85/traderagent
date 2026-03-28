// src/sync/DataSyncService.ts
import type { IDataSource } from '../data/IDataSource.js'
import type { DataType, Market } from '../agents/base/types.js'
import { prisma } from '../db/client.js'

const DATA_TYPES: DataType[] = ['ohlcv', 'fundamentals', 'news', 'technicals']

type SyncOptions = {
  maxRetries?: number
  baseDelayMs?: number
}

export class DataSyncService {
  private sources: IDataSource[]
  private maxRetries: number
  private baseDelayMs: number

  constructor(sources: IDataSource[], options?: SyncOptions) {
    this.sources = sources
    this.maxRetries = options?.maxRetries ?? 3
    this.baseDelayMs = options?.baseDelayMs ?? 1000
  }

  async syncAll(): Promise<void> {
    const tickers = await prisma.watchlist.findMany({ where: { active: true } })
    console.log(`[DataSync] Syncing ${tickers.length} tickers`)

    for (const entry of tickers) {
      await this.syncTicker(entry.ticker, entry.market as Market)
    }

    console.log('[DataSync] Sync complete')
  }

  async syncTicker(ticker: string, market: Market): Promise<void> {
    console.log(`[DataSync] Syncing ${ticker} (${market})`)

    for (const dataType of DATA_TYPES) {
      await this.syncDataType(ticker, market, dataType)
    }
  }

  private async syncDataType(ticker: string, market: Market, dataType: DataType): Promise<void> {
    const start = Date.now()

    for (const source of this.sources) {
      let lastError: Error | null = null

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const result = await source.fetch({ ticker, market, type: dataType })
          await this.writeToDb(ticker, market, dataType, result.data, source.name)
          await this.logFetch(ticker, market, dataType, source.name, 'success', null, Date.now() - start)
          return // success
        } catch (err) {
          lastError = err as Error
          if (attempt < this.maxRetries) {
            const delay = this.baseDelayMs * Math.pow(4, attempt - 1)
            await new Promise((r) => setTimeout(r, delay))
          }
        }
      }

      console.warn(
        `[DataSync] ${source.name}/${dataType} failed for ${ticker} after ${this.maxRetries} retries: ${lastError?.message}`,
      )
    }

    // All sources failed for this data type
    await this.logFetch(ticker, market, dataType, 'all', 'failed', 'All sources exhausted', Date.now() - start)
  }

  private async writeToDb(
    ticker: string,
    market: string,
    dataType: DataType,
    data: unknown,
    source: string,
  ): Promise<void> {
    switch (dataType) {
      case 'ohlcv': {
        const rawData = data as { quotes?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
        const bars = Array.isArray(rawData) ? rawData : rawData.quotes ?? []
        if (bars.length === 0) return
        await prisma.ohlcv.createMany({
          data: bars.map((bar: Record<string, unknown>) => ({
            ticker,
            market,
            date: new Date(bar.date as string),
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
            volume: BigInt(Math.round(Number(bar.volume))),
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
        const rawNews = data as { news?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
        const articles = Array.isArray(rawNews) ? rawNews : rawNews.news ?? []
        if (articles.length === 0) return
        await prisma.news.createMany({
          data: articles.map((a: Record<string, unknown>) => ({
            ticker,
            market,
            title: String(a.title ?? 'Untitled'),
            url: String(a.link ?? a.url ?? `${ticker}-${Date.now()}-${Math.random()}`),
            source,
            publishedAt: a.publishedAt ? new Date(a.publishedAt as string) : new Date(),
            data: a as object,
          })),
          skipDuplicates: true,
        })
        break
      }
      case 'technicals': {
        // Raw technicals data is OHLCV — store as ohlcv with longer window
        const rawData = data as { quotes?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
        const bars = Array.isArray(rawData) ? rawData : rawData.quotes ?? []
        if (bars.length === 0) return
        await prisma.ohlcv.createMany({
          data: bars.map((bar: Record<string, unknown>) => ({
            ticker,
            market,
            date: new Date(bar.date as string),
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
            volume: BigInt(Math.round(Number(bar.volume))),
            source,
          })),
          skipDuplicates: true,
        })
        break
      }
    }
  }

  private async logFetch(
    ticker: string,
    market: string,
    dataType: string,
    source: string,
    status: string,
    error: string | null,
    duration: number,
  ): Promise<void> {
    await prisma.fetchLog.create({
      data: { ticker, market, dataType, source, status, error, duration },
    })
  }
}
