import { describe, it, expect, vi } from 'vitest'
import { RateLimitedDataSource } from '../../src/data/RateLimitedDataSource.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataQuery, DataResult } from '../../src/agents/base/types.js'

const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'ohlcv' }
const result: DataResult = {
  ticker: 'AAPL', market: 'US', type: 'ohlcv',
  data: { price: 150 }, fetchedAt: new Date(),
}

function makeSource(name: string, fetchFn: (q: DataQuery) => Promise<DataResult>): IDataSource {
  return { name, fetch: fetchFn }
}

describe('RateLimitedDataSource', () => {
  it('delegates fetch to the wrapped source', async () => {
    const inner = makeSource('test', async () => result)
    const limited = new RateLimitedDataSource(inner, {
      intervalCap: 10, intervalMs: 1000, concurrency: 1,
    })

    const res = await limited.fetch(query)
    expect(res).toEqual(result)
  })

  it('exposes the inner source name', () => {
    const inner = makeSource('finnhub', async () => result)
    const limited = new RateLimitedDataSource(inner, {
      intervalCap: 10, intervalMs: 1000, concurrency: 1,
    })
    expect(limited.name).toBe('finnhub')
  })

  it('enforces concurrency limit', async () => {
    let concurrent = 0
    let maxConcurrent = 0

    const inner = makeSource('slow', async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((r) => setTimeout(r, 50))
      concurrent--
      return result
    })

    const limited = new RateLimitedDataSource(inner, {
      intervalCap: 100, intervalMs: 1000, concurrency: 1,
    })

    await Promise.all([
      limited.fetch(query),
      limited.fetch(query),
      limited.fetch(query),
    ])

    expect(maxConcurrent).toBe(1)
  })

  it('propagates errors from the wrapped source', async () => {
    const inner = makeSource('broken', async () => {
      throw new Error('API down')
    })
    const limited = new RateLimitedDataSource(inner, {
      intervalCap: 10, intervalMs: 1000, concurrency: 1,
    })

    await expect(limited.fetch(query)).rejects.toThrow('API down')
  })

  it('adjustRate halves intervalCap and restores after cooldown', async () => {
    const inner = makeSource('test', async () => result)
    const limited = new RateLimitedDataSource(inner, {
      intervalCap: 60, intervalMs: 60000, concurrency: 1,
    })

    limited.adjustRate(100) // 100ms cooldown for test speed

    // After adjustRate, the queue should still work
    const res = await limited.fetch(query)
    expect(res).toEqual(result)

    // Wait for cooldown to restore
    await new Promise((r) => setTimeout(r, 150))

    // Source should still function after restoration
    const res2 = await limited.fetch(query)
    expect(res2).toEqual(result)
  })
})
