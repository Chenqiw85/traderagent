import { describe, it, expect, vi } from 'vitest'
import { FallbackDataSource } from '../../src/data/FallbackDataSource.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataQuery, DataResult } from '../../src/agents/base/types.js'

function makeSource(name: string, fn: (q: DataQuery) => Promise<DataResult>): IDataSource {
  return { name, fetch: fn }
}

const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'ohlcv' }

describe('FallbackDataSource', () => {
  it('returns result from first source when it succeeds', async () => {
    const result: DataResult = { ticker: 'AAPL', market: 'US', type: 'ohlcv', data: { price: 100 }, fetchedAt: new Date() }
    const s1 = makeSource('s1', async () => result)
    const s2 = makeSource('s2', async () => { throw new Error('should not be called') })
    const fallback = new FallbackDataSource('test-chain', [s1, s2])
    expect(await fallback.fetch(query)).toEqual(result)
  })

  it('falls back to second source when first throws', async () => {
    const result: DataResult = { ticker: 'AAPL', market: 'US', type: 'ohlcv', data: { price: 200 }, fetchedAt: new Date() }
    const s1 = makeSource('s1', async () => { throw new Error('403 Forbidden') })
    const s2 = makeSource('s2', async () => result)
    const fallback = new FallbackDataSource('test-chain', [s1, s2])
    expect(await fallback.fetch(query)).toEqual(result)
  })

  it('throws with all errors when every source fails', async () => {
    const s1 = makeSource('s1', async () => { throw new Error('403 Forbidden') })
    const s2 = makeSource('s2', async () => { throw new Error('429 Too Many Requests') })
    const fallback = new FallbackDataSource('test-chain', [s1, s2])
    await expect(fallback.fetch(query)).rejects.toThrow('All sources failed for ohlcv')
  })

  it('includes per-source error details in the thrown error', async () => {
    const s1 = makeSource('s1', async () => { throw new Error('403 Forbidden') })
    const s2 = makeSource('s2', async () => { throw new Error('429 Too Many') })
    const fallback = new FallbackDataSource('test-chain', [s1, s2])
    await expect(fallback.fetch(query)).rejects.toThrow('s1: 403 Forbidden')
    await expect(fallback.fetch(query)).rejects.toThrow('s2: 429 Too Many')
  })

  it('exposes the chain name as .name', () => {
    const fallback = new FallbackDataSource('price-chain', [])
    expect(fallback.name).toBe('price-chain')
  })
})
