// src/sync/DataSyncService.ts
import type { IDataSource } from '../data/IDataSource.js'
import type { DataType, Market } from '../agents/base/types.js'
import { RateLimitError } from '../data/errors.js'
import { RateLimitedDataSource } from '../data/RateLimitedDataSource.js'
import { prisma } from '../db/client.js'

const DATA_TYPES: DataType[] = ['ohlcv', 'fundamentals', 'news', 'technicals']

const RATE_LIMIT_BACKOFF_FLOOR_MS = 5_000

type SyncOptions = {
  maxRetries?: number
  maxRateLimitRetries?: number
  baseDelayMs?: number
  rateLimitBackoffFloorMs?: number
}

export class DataSyncService {
  private sources: IDataSource[]
  private maxRetries: number
  private maxRateLimitRetries: number
  private baseDelayMs: number
  private rateLimitBackoffFloorMs: number

  constructor(sources: IDataSource[], options?: SyncOptions) {
    this.sources = sources
    this.maxRetries = options?.maxRetries ?? 3
    this.maxRateLimitRetries = options?.maxRateLimitRetries ?? 2
    this.baseDelayMs = options?.baseDelayMs ?? 1000
    this.rateLimitBackoffFloorMs = options?.rateLimitBackoffFloorMs ?? RATE_LIMIT_BACKOFF_FLOOR_MS
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
      let rateLimitRetries = 0
      let errorRetries = 0

      const maxAttempts = this.maxRetries + this.maxRateLimitRetries
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const result = await source.fetch({ ticker, market, type: dataType })
          await this.writeToDb(ticker, market, dataType, result.data, source.name)
          await this.logFetch(ticker, market, dataType, source.name, 'success', null, Date.now() - start)
          return // success
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))

          if (RateLimitError.isRateLimitError(err)) {
            rateLimitRetries++
            if (rateLimitRetries > this.maxRateLimitRetries) break

            // Dynamically slow the queue if source supports it
            if (source instanceof RateLimitedDataSource) {
              source.adjustRate()
            }

            const waitMs = Math.max(
              err.retryAfterMs ?? this.rateLimitBackoffFloorMs,
              this.rateLimitBackoffFloorMs,
            )
            console.warn(
              `[DataSync] ${source.name}/${dataType} rate limited for ${ticker}, waiting ${waitMs}ms (attempt ${rateLimitRetries}/${this.maxRateLimitRetries})`,
            )
            await new Promise((r) => setTimeout(r, waitMs))
          } else {
            errorRetries++
            if (errorRetries >= this.maxRetries) break

            const delay = this.baseDelayMs * Math.pow(4, errorRetries - 1)
            await new Promise((r) => setTimeout(r, delay))
          }
        }
      }

      console.warn(
        `[DataSync] ${source.name}/${dataType} failed for ${ticker} after retries: ${lastError?.message}`,
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
            date: bar.date ? new Date(bar.date as string) : new Date(),
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
            volume: BigInt(Math.round(Number(bar.volume))),
            source,
          })).filter((row) => !isNaN(row.date.getTime())),
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
        const rawData = data as { quotes?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
        const bars = Array.isArray(rawData) ? rawData : rawData.quotes ?? []
        if (bars.length === 0) return
        await prisma.ohlcv.createMany({
          data: bars.map((bar: Record<string, unknown>) => ({
            ticker,
            market,
            date: bar.date ? new Date(bar.date as string) : new Date(),
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
            volume: BigInt(Math.round(Number(bar.volume))),
            source,
          })).filter((row) => !isNaN(row.date.getTime())),
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
