// tests/data/newsapi.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NewsAPISource } from '../../src/data/newsapi.js'

const mockFetch = vi.fn()

describe('NewsAPISource', () => {
  let source: NewsAPISource

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    source = new NewsAPISource({ apiKey: 'test-key' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has correct name', () => {
    expect(source.name).toBe('newsapi')
  })

  it('fetches news articles', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        articles: [
          { title: 'AAPL rises 5%', source: { name: 'Reuters' } },
        ],
      }),
    })

    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'news' })
    expect(result.ticker).toBe('AAPL')
    expect(result.type).toBe('news')
    expect(Array.isArray(result.data)).toBe(true)
  })

  it('throws for non-news type', async () => {
    await expect(
      source.fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' }),
    ).rejects.toThrow('NewsAPISource only supports type "news"')
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' })
    await expect(
      source.fetch({ ticker: 'AAPL', market: 'US', type: 'news' }),
    ).rejects.toThrow('NewsAPI request failed: 401')
  })
})
