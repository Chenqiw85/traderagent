// tests/data/finnhub.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FinnhubSource } from '../../src/data/finnhub.js'

const mockFetch = vi.fn()

describe('FinnhubSource', () => {
  let source: FinnhubSource

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    source = new FinnhubSource({ apiKey: 'test-key' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has correct name', () => {
    expect(source.name).toBe('finnhub')
  })

  it('fetches news', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ headline: 'AAPL earnings beat', datetime: 1704067200 }],
    })
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'news' })
    expect(result.type).toBe('news')
    expect(result.data).toBeDefined()
  })

  it('fetches fundamentals', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Apple Inc.' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ metric: {} }) })
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'fundamentals' })
    expect(result.type).toBe('fundamentals')
  })

  it('fetches OHLCV', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ c: [150], h: [155], l: [149], o: [151], v: [1000000], t: [1704067200], s: 'ok' }),
    })
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' })
    expect(result.type).toBe('ohlcv')
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, statusText: 'Forbidden' })
    await expect(
      source.fetch({ ticker: 'AAPL', market: 'US', type: 'news' }),
    ).rejects.toThrow('Finnhub request failed: 403')
  })
})
