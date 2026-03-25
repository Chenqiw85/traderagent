// tests/data/akshare.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AkShareSource } from '../../src/data/akshare.js'

const mockFetch = vi.fn()

describe('AkShareSource', () => {
  let source: AkShareSource

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    source = new AkShareSource({ baseURL: 'http://localhost:8080' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has correct name', () => {
    expect(source.name).toBe('akshare')
  })

  it('fetches CN OHLCV via stock_zh_a_hist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ date: '2024-01-01', open: 10, high: 11, low: 9.5, close: 10.5 }],
    })
    const result = await source.fetch({ ticker: '000001', market: 'CN', type: 'ohlcv' })
    expect(result.type).toBe('ohlcv')
    expect(result.market).toBe('CN')
    // Verify the right endpoint was called
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/stock_zh_a_hist',
      expect.any(Object),
    )
  })

  it('fetches HK OHLCV via stock_hk_hist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ date: '2024-01-01', open: 150, high: 155, low: 148, close: 153 }],
    })
    const result = await source.fetch({ ticker: '00700', market: 'HK', type: 'ohlcv' })
    expect(result.market).toBe('HK')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/stock_hk_hist',
      expect.any(Object),
    )
  })

  it('fetches fundamentals', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ roe: 15.2, pe_ratio: 12.5 }),
    })
    const result = await source.fetch({ ticker: '000001', market: 'CN', type: 'fundamentals' })
    expect(result.type).toBe('fundamentals')
  })

  it('fetches news', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ title: 'Market update' }],
    })
    const result = await source.fetch({ ticker: '000001', market: 'CN', type: 'news' })
    expect(result.type).toBe('news')
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502, statusText: 'Bad Gateway' })
    await expect(
      source.fetch({ ticker: '000001', market: 'CN', type: 'ohlcv' }),
    ).rejects.toThrow('AkShare request failed: 502')
  })
})
