import PQueue from 'p-queue'
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'
import type { RateLimitConfig } from '../config/rateLimits.js'

export class RateLimitedDataSource implements IDataSource {
  readonly name: string
  private readonly inner: IDataSource
  private readonly queue: PQueue
  private readonly originalConfig: Readonly<RateLimitConfig>
  private restoreTimer: ReturnType<typeof setTimeout> | null = null

  constructor(inner: IDataSource, config: RateLimitConfig) {
    this.name = inner.name
    this.inner = inner
    this.originalConfig = { ...config }
    this.queue = new PQueue({
      concurrency: config.concurrency,
      interval: config.intervalMs,
      intervalCap: config.intervalCap,
    })
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    return this.queue.add(() => this.inner.fetch(query)) as Promise<DataResult>
  }

  /**
   * Pause the queue for `cooldownMs` milliseconds to avoid hitting rate limits,
   * then resume. Unlike replacing the queue, this preserves in-flight requests.
   */
  adjustRate(cooldownMs: number = 60_000): void {
    if (this.restoreTimer !== null) return // already adjusting

    this.queue.pause()

    this.restoreTimer = setTimeout(() => {
      this.queue.start()
      this.restoreTimer = null
    }, cooldownMs)
  }
}
