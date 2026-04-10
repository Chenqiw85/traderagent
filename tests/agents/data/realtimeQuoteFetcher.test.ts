import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RealtimeQuoteFetcher } from '../../../src/agents/data/RealtimeQuoteFetcher.js'
import type { LiveMarketSnapshot, TradingReport } from '../../../src/agents/base/types.js'
import type { ILiveMarketDataSource } from '../../../src/data/ILiveMarketDataSource.js'

const { warnMock } = vi.hoisted(() => ({
  warnMock: vi.fn(),
}))

vi.mock('../../../src/utils/logger.js', () => ({
  createLogger: () => ({
    warn: warnMock,
  }),
}))

function makeReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-08T20:00:00.000Z'),
    rawData: [],
    researchFindings: [],
    analysisArtifacts: [],
  }
}

function makeSource(
  impl: (ticker: string, market: TradingReport['market']) => Promise<LiveMarketSnapshot>,
): ILiveMarketDataSource {
  return {
    name: 'test-live-source',
    fetchLiveSnapshot: vi.fn().mockImplementation(({ ticker, market }) => impl(ticker, market)),
  }
}

describe('RealtimeQuoteFetcher', () => {
  beforeEach(() => {
    warnMock.mockClear()
  })

  it('attaches a live market snapshot to the report when the source succeeds', async () => {
    const snapshot: LiveMarketSnapshot = {
      source: 'test-live-source',
      fetchedAt: new Date('2026-04-08T20:01:00.000Z'),
      regularMarketPrice: 151.25,
    }
    const source = makeSource(async (ticker, market) => {
      expect(ticker).toBe('AAPL')
      expect(market).toBe('US')
      return snapshot
    })
    const fetcher = new RealtimeQuoteFetcher({ liveMarketDataSource: source })
    const report = makeReport()

    const result = await fetcher.run(report)

    expect(result).not.toBe(report)
    expect(result.liveMarketSnapshot).toEqual(snapshot)
    expect(report.liveMarketSnapshot).toBeUndefined()
    expect(warnMock).not.toHaveBeenCalled()
  })

  it('logs a warning and returns the original report unchanged when fetch fails', async () => {
    const source = makeSource(async () => {
      throw new Error('live feed unavailable')
    })
    const fetcher = new RealtimeQuoteFetcher({ liveMarketDataSource: source })
    const report = makeReport()

    const result = await fetcher.run(report)

    expect(result).toBe(report)
    expect(result.liveMarketSnapshot).toBeUndefined()
    expect(warnMock).toHaveBeenCalledTimes(1)
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'AAPL',
        market: 'US',
        sourceChain: 'test-live-source',
        error: 'live feed unavailable',
      }),
      expect.stringContaining('Live market snapshot fetch failed from test-live-source'),
    )
  })

  it('treats a resolved but empty live snapshot as no overlay', async () => {
    const emptySnapshot: LiveMarketSnapshot = {
      source: 'test-live-source',
      fetchedAt: new Date('2026-04-08T20:01:00.000Z'),
    }
    const source = makeSource(async () => emptySnapshot)
    const fetcher = new RealtimeQuoteFetcher({ liveMarketDataSource: source })
    const report = makeReport()

    const result = await fetcher.run(report)

    expect(result).toBe(report)
    expect(result.liveMarketSnapshot).toBeUndefined()
    expect(warnMock).toHaveBeenCalledTimes(1)
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'AAPL',
        market: 'US',
        sourceChain: 'test-live-source',
      }),
      expect.stringContaining('resolved without usable quote payload'),
    )
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite quote values like %s',
    async (badValue) => {
      const source = makeSource(async () => ({
        source: 'test-live-source',
        fetchedAt: new Date('2026-04-08T20:01:00.000Z'),
        regularMarketPrice: badValue,
      }))
      const fetcher = new RealtimeQuoteFetcher({ liveMarketDataSource: source })
      const report = makeReport()

      const result = await fetcher.run(report)

      expect(result).toBe(report)
      expect(result.liveMarketSnapshot).toBeUndefined()
      expect(warnMock).toHaveBeenCalledTimes(1)
      expect(warnMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ticker: 'AAPL',
          market: 'US',
          sourceChain: 'test-live-source',
        }),
        expect.stringContaining('resolved without usable quote payload'),
      )
    },
  )
})
