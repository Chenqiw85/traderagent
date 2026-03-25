// tests/data/secedgar.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SECEdgarSource } from '../../src/data/secedgar.js'

const mockFetch = vi.fn()

describe('SECEdgarSource', () => {
  let source: SECEdgarSource

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    source = new SECEdgarSource({ userAgent: 'TestApp test@example.com' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has correct name', () => {
    expect(source.name).toBe('secedgar')
  })

  it('fetches fundamentals (SEC filings)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hits: { hits: [{ _source: { file_description: '10-K Annual Report' } }] },
      }),
    })
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'fundamentals' })
    expect(result.type).toBe('fundamentals')
    expect(result.data).toBeDefined()
  })

  it('throws for non-fundamentals type', async () => {
    await expect(
      source.fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' }),
    ).rejects.toThrow('SECEdgarSource only supports type "fundamentals"')
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
    await expect(
      source.fetch({ ticker: 'AAPL', market: 'US', type: 'fundamentals' }),
    ).rejects.toThrow('SEC EDGAR request failed: 500')
  })
})
