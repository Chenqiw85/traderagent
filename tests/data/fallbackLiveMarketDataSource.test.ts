import { describe, it, expect } from 'vitest'
import { FallbackLiveMarketDataSource } from '../../src/data/FallbackLiveMarketDataSource.js'
import type { ILiveMarketDataSource } from '../../src/data/ILiveMarketDataSource.js'
import type { LiveMarketQuery } from '../../src/data/ILiveMarketDataSource.js'
import type { LiveMarketSnapshot } from '../../src/agents/base/types.js'

function makeSource(
  name: string,
  fn: (query: LiveMarketQuery) => Promise<LiveMarketSnapshot>,
): ILiveMarketDataSource {
  return { name, fetchLiveSnapshot: fn }
}

const query: LiveMarketQuery = { ticker: 'AAPL', market: 'US' }

describe('FallbackLiveMarketDataSource', () => {
  it('returns the first successful live snapshot', async () => {
    const snapshot: LiveMarketSnapshot = {
      source: 'primary',
      fetchedAt: new Date('2026-04-08T20:00:00.000Z'),
      regularMarketPrice: 150,
    }
    const first = makeSource('first', async () => snapshot)
    const second = makeSource('second', async () => {
      throw new Error('should not be called')
    })
    const fallback = new FallbackLiveMarketDataSource('live-chain', [first, second])

    await expect(fallback.fetchLiveSnapshot(query)).resolves.toEqual(snapshot)
  })

  it('falls back after the first source throws', async () => {
    const snapshot: LiveMarketSnapshot = {
      source: 'secondary',
      fetchedAt: new Date('2026-04-08T20:00:00.000Z'),
      regularMarketPrice: 151,
    }
    const first = makeSource('first', async () => {
      throw new Error('403 Forbidden')
    })
    const second = makeSource('second', async () => snapshot)
    const fallback = new FallbackLiveMarketDataSource('live-chain', [first, second])

    await expect(fallback.fetchLiveSnapshot(query)).resolves.toEqual(snapshot)
  })

  it('throws a combined error when all live sources fail', async () => {
    const first = makeSource('first', async () => {
      throw new Error('403 Forbidden')
    })
    const second = makeSource('second', async () => {
      throw new Error('429 Too Many Requests')
    })
    const fallback = new FallbackLiveMarketDataSource('live-chain', [first, second])
    const promise = fallback.fetchLiveSnapshot(query)

    await expect(promise).rejects.toThrow('All live market sources failed for AAPL')
    await expect(promise).rejects.toThrow('first: 403 Forbidden')
    await expect(promise).rejects.toThrow('second: 429 Too Many Requests')
  })

  it('rejects empty source lists with a clear error', async () => {
    const fallback = new FallbackLiveMarketDataSource('live-chain', [])

    await expect(fallback.fetchLiveSnapshot(query)).rejects.toThrow('No live market sources configured for AAPL')
  })
})
