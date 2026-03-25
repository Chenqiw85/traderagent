// tests/data/tushare.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TushareSource } from '../../src/data/tushare.js'

const mockFetch = vi.fn()

describe('TushareSource', () => {
  let source: TushareSource

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    source = new TushareSource({ token: 'test-token' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('has correct name', () => {
    expect(source.name).toBe('tushare')
  })

  it('fetches OHLCV data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        msg: '',
        data: { fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'vol'], items: [] },
      }),
    })
    const result = await source.fetch({ ticker: '000001.SZ', market: 'CN', type: 'ohlcv' })
    expect(result.type).toBe('ohlcv')
    expect(result.market).toBe('CN')
  })

  it('fetches fundamentals', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, msg: '', data: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, msg: '', data: {} }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 0, msg: '', data: {} }) })
    const result = await source.fetch({ ticker: '000001.SZ', market: 'CN', type: 'fundamentals' })
    expect(result.type).toBe('fundamentals')
  })

  it('throws on API error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: -1, msg: 'token expired', data: null }),
    })
    await expect(
      source.fetch({ ticker: '000001.SZ', market: 'CN', type: 'ohlcv' }),
    ).rejects.toThrow('Tushare API error: token expired')
  })

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' })
    await expect(
      source.fetch({ ticker: '000001.SZ', market: 'CN', type: 'ohlcv' }),
    ).rejects.toThrow('Tushare request failed: 500')
  })
})
