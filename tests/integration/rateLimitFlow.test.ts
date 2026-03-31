import { describe, it, expect } from 'vitest'
import { RateLimitedDataSource } from '../../src/data/RateLimitedDataSource.js'
import { FallbackDataSource } from '../../src/data/FallbackDataSource.js'
import { RateLimitError } from '../../src/data/errors.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataQuery, DataResult } from '../../src/agents/base/types.js'

const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'ohlcv' }
const successResult: DataResult = {
  ticker: 'AAPL', market: 'US', type: 'ohlcv',
  data: { price: 150 }, fetchedAt: new Date(),
}

function makeSource(name: string, fetchFn: (q: DataQuery) => Promise<DataResult>): IDataSource {
  return { name, fetch: fetchFn }
}

describe('Rate limit integration flow', () => {
  it('rate-limited source queues requests without 429', async () => {
    const fetchTimes: number[] = []
    const inner = makeSource('throttled', async () => {
      fetchTimes.push(Date.now())
      return successResult
    })

    // 2 requests per 200ms
    const limited = new RateLimitedDataSource(inner, {
      intervalCap: 2, intervalMs: 200, concurrency: 1,
    })

    // Fire 4 requests — first 2 go immediately, next 2 wait for next interval
    await Promise.all([
      limited.fetch(query),
      limited.fetch(query),
      limited.fetch(query),
      limited.fetch(query),
    ])

    expect(fetchTimes).toHaveLength(4)
    // Last request should be at least 150ms after the first (allowing some tolerance)
    const elapsed = fetchTimes[3]! - fetchTimes[0]!
    expect(elapsed).toBeGreaterThanOrEqual(150)
  })

  it('fallback chain skips rate-limited source and uses next', async () => {
    const alwaysRateLimited = makeSource('limited', async () => {
      throw new RateLimitError('limited', 429)
    })
    const healthy = makeSource('healthy', async () => successResult)

    const fallback = new FallbackDataSource('test-chain', [alwaysRateLimited, healthy])
    const result = await fallback.fetch(query)

    expect(result).toEqual(successResult)
  })

  it('429 then recovery within same source', async () => {
    let calls = 0
    const flaky = makeSource('flaky', async () => {
      calls++
      if (calls === 1) throw new RateLimitError('flaky', 429, 10)
      return successResult
    })

    const limited = new RateLimitedDataSource(flaky, {
      intervalCap: 60, intervalMs: 60000, concurrency: 1,
    })

    // First call gets 429, second succeeds
    await expect(limited.fetch(query)).rejects.toBeInstanceOf(RateLimitError)
    const result = await limited.fetch(query)
    expect(result).toEqual(successResult)
    expect(calls).toBe(2)
  })
})
