import PQueue from 'p-queue'
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'
import type { RateLimitConfig } from '../config/rateLimits.js'

export class RateLimitedDataSource implements IDataSource {
  readonly name: string
  private readonly inner: IDataSource
  private queue: PQueue
  private readonly originalConfig: Readonly<RateLimitConfig>
  private restoreTimer: ReturnType<typeof setTimeout> | null = null

  constructor(inner: IDataSource, config: RateLimitConfig) {
    this.name = inner.name
    this.inner = inner
    this.originalConfig = { ...config }
    this.queue = this.createQueue(config)
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    return this.queue.add(() => this.inner.fetch(query)) as Promise<DataResult>
  }

  /**
   * Halve the intervalCap for `cooldownMs` milliseconds,
   * then restore original rate. Prevents queued requests
   * from also hitting the rate limit.
   */
  adjustRate(cooldownMs: number = 60_000): void {
    if (this.restoreTimer !== null) return // already adjusting

    const reducedCap = Math.max(1, Math.floor(this.originalConfig.intervalCap / 2))
    this.queue = this.createQueue({
      ...this.originalConfig,
      intervalCap: reducedCap,
    })

    this.restoreTimer = setTimeout(() => {
      this.queue = this.createQueue(this.originalConfig)
      this.restoreTimer = null
    }, cooldownMs)
  }

  private createQueue(config: RateLimitConfig): PQueue {
    return new PQueue({
      concurrency: config.concurrency,
      interval: config.intervalMs,
      intervalCap: config.intervalCap,
    })
  }
}
