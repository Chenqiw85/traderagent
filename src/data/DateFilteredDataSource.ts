import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('date-filter')

/**
 * Decorator that wraps any IDataSource and enforces a cutoff date.
 * - Clamps query.to to cutoffDate
 * - Post-filters OHLCV bars to exclude dates after cutoffDate
 * - Prevents look-ahead bias during backtesting
 */
export class DateFilteredDataSource implements IDataSource {
  readonly name: string
  private readonly inner: IDataSource
  private readonly cutoffDate: Date

  constructor(inner: IDataSource, cutoffDate: Date) {
    this.inner = inner
    this.name = `${inner.name}[≤${cutoffDate.toISOString().slice(0, 10)}]`
    this.cutoffDate = cutoffDate
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    // Clamp query.to to cutoff date
    const clampedQuery: DataQuery = {
      ...query,
      to: query.to && query.to > this.cutoffDate ? this.cutoffDate : query.to,
    }

    const result = await this.inner.fetch(clampedQuery)

    // Post-filter OHLCV data to remove any bars after cutoff
    if (result.type === 'ohlcv') {
      return {
        ...result,
        data: this.filterOhlcvData(result.data),
      }
    }

    // Post-filter news data to remove articles after cutoff
    if (result.type === 'news') {
      return {
        ...result,
        data: this.filterNewsData(result.data),
      }
    }

    return result
  }

  private filterOhlcvData(data: unknown): unknown {
    const cutoff = this.cutoffDate.getTime()

    if (Array.isArray(data)) {
      const filtered = data.filter((bar: Record<string, unknown>) => {
        const dateVal = bar.date ?? bar.Date
        if (dateVal == null) return true
        const barTime = new Date(String(dateVal)).getTime()
        return !isNaN(barTime) && barTime <= cutoff
      })
      if (filtered.length < data.length) {
        log.debug({ removed: data.length - filtered.length }, 'Filtered future OHLCV bars')
      }
      return filtered
    }

    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>
      if (Array.isArray(d.quotes)) {
        const filtered = (d.quotes as Record<string, unknown>[]).filter((bar) => {
          const dateVal = bar.date ?? bar.Date
          if (dateVal == null) return true
          const barTime = new Date(String(dateVal)).getTime()
          return !isNaN(barTime) && barTime <= cutoff
        })
        return { ...d, quotes: filtered }
      }

      // Finnhub candle format
      if (d.s === 'ok' && Array.isArray(d.t)) {
        const timestamps = d.t as number[]
        const cutoffSec = cutoff / 1000
        const mask = timestamps.map((t) => t <= cutoffSec)
        const filterArray = <T>(arr: unknown): T[] => {
          if (!Array.isArray(arr)) return arr as T[]
          return arr.filter((_, i) => mask[i])
        }
        return {
          ...d,
          t: filterArray(d.t),
          c: filterArray(d.c),
          o: filterArray(d.o),
          h: filterArray(d.h),
          l: filterArray(d.l),
          v: filterArray(d.v),
        }
      }
    }

    return data
  }

  private filterNewsData(data: unknown): unknown {
    const cutoff = this.cutoffDate.getTime()

    if (Array.isArray(data)) {
      return data.filter((article: Record<string, unknown>) => {
        const published = article.publishedAt ?? article.datetime ?? article.date
        if (published == null) return true
        const pubTime = typeof published === 'number'
          ? published * 1000 // unix timestamp
          : new Date(String(published)).getTime()
        return !isNaN(pubTime) && pubTime <= cutoff
      })
    }

    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>
      if (Array.isArray(d.news)) {
        return {
          ...d,
          news: (d.news as Record<string, unknown>[]).filter((article) => {
            const published = article.publishedAt ?? article.datetime ?? article.date
            if (published == null) return true
            const pubTime = typeof published === 'number'
              ? published * 1000
              : new Date(String(published)).getTime()
            return !isNaN(pubTime) && pubTime <= cutoff
          }),
        }
      }
    }

    return data
  }
}
