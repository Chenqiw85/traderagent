import { describe, expect, it } from 'vitest'
import type { DataResult, LiveMarketSnapshot, TradingReport } from '../../src/agents/base/types.js'
import {
  formatLiveMarketContextLines,
  formatLiveMarketReportLines,
  resolveEffectiveLivePrice,
} from '../../src/utils/liveMarketSnapshot.js'

function makeSnapshot(overrides: Partial<LiveMarketSnapshot> = {}): LiveMarketSnapshot {
  return {
    source: 'mock-live-source',
    fetchedAt: new Date('2026-04-08T20:00:00.000Z'),
    marketState: 'POSTMARKET',
    regularMarketPrice: 150,
    postMarketPrice: 152.3,
    bid: 152.25,
    ask: 152.35,
    dayHigh: 153,
    dayLow: 148.2,
    volume: 1250000,
    ...overrides,
  }
}

function makeReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-08T20:00:00.000Z'),
    rawData: [
      {
        ticker: 'AAPL',
        market: 'US',
        type: 'ohlcv',
        fetchedAt: new Date('2026-04-08T20:00:00.000Z'),
        data: [
          {
            date: '2026-04-07T20:00:00.000Z',
            open: 146,
            high: 149,
            low: 145,
            close: 147,
            volume: 1000000,
          },
          {
            date: '2026-04-08T20:00:00.000Z',
            open: 149,
            high: 151,
            low: 148,
            close: 150,
            volume: 1250000,
          },
        ],
      } satisfies DataResult,
    ],
    researchFindings: [],
    analysisArtifacts: [],
  }
}

describe('liveMarketSnapshot helpers', () => {
  it('prefers postmarket price when marketState indicates postmarket', () => {
    const snapshot = makeSnapshot()

    expect(resolveEffectiveLivePrice(snapshot)).toBe(152.3)
  })

  it('falls back to regular market price when no session-specific price exists', () => {
    const snapshot = makeSnapshot({
      marketState: 'OPEN',
      postMarketPrice: undefined,
      preMarketPrice: undefined,
      regularMarketPrice: 150,
    })

    expect(resolveEffectiveLivePrice(snapshot)).toBe(150)
  })

  it('formats planner and manager context lines with the latest close and delta', () => {
    const lines = formatLiveMarketContextLines({
      ...makeReport(),
      liveMarketSnapshot: makeSnapshot(),
    })

    expect(lines).toContain('Live market snapshot')
    expect(lines).toContain('Session: postmarket')
    expect(lines).toContain('Effective live price: $152.30')
    expect(lines).toContain('Latest daily close: $150.00')
    expect(lines).toContain('Delta vs close: +$2.30 (+1.53%)')
  })

  it('returns no live market context lines when the snapshot is absent', () => {
    expect(formatLiveMarketContextLines(makeReport())).toEqual([])
  })

  it('formats live market report lines with market state, effective price, and bid/ask', () => {
    const lines = formatLiveMarketReportLines(makeSnapshot())

    expect(lines).toContain('Market State: postmarket')
    expect(lines).toContain('Effective Price: $152.30')
    expect(lines).toContain('Bid/Ask: $152.25 / $152.35')
  })

  it('uses the most recent dated OHLCV bar even when bars arrive unsorted', () => {
    const report: TradingReport = {
      ...makeReport(),
      rawData: [
        {
          ticker: 'AAPL',
          market: 'US',
          type: 'ohlcv',
          fetchedAt: new Date('2026-04-08T20:00:00.000Z'),
          data: [
            {
              date: '2026-04-08T20:00:00.000Z',
              open: 149,
              high: 151,
              low: 148,
              close: 150,
              volume: 1250000,
            },
            {
              date: '2026-04-06T20:00:00.000Z',
              open: 145,
              high: 148,
              low: 144,
              close: 146,
              volume: 900000,
            },
            {
              date: '2026-04-07T20:00:00.000Z',
              open: 146,
              high: 149,
              low: 145,
              close: 147,
              volume: 1000000,
            },
          ],
        } satisfies DataResult,
      ],
    }

    const lines = formatLiveMarketContextLines({
      ...report,
      liveMarketSnapshot: makeSnapshot(),
    })

    expect(lines).toContain('Latest daily close: $150.00')
    expect(lines).toContain('Delta vs close: +$2.30 (+1.53%)')
  })

  it('formats non-USD live snapshot lines using the snapshot currency', () => {
    const snapshot = makeSnapshot({
      currency: 'EUR',
      regularMarketPrice: 150.2,
      postMarketPrice: 151.6,
    })

    const reportLines = formatLiveMarketReportLines(snapshot)
    const contextLines = formatLiveMarketContextLines({
      ...makeReport(),
      liveMarketSnapshot: snapshot,
    })

    expect(reportLines).toContain('Effective Price: €151.60')
    expect(reportLines).toContain('Bid/Ask: €152.25 / €152.35')
    expect(contextLines).toContain('Effective live price: €151.60')
    expect(contextLines).toContain('Latest daily close: €150.00')
    expect(contextLines).toContain('Delta vs close: +€1.60 (+1.07%)')
  })
})
