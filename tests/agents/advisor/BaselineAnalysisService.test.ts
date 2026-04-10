import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaselineAnalysisService } from '../../../src/agents/advisor/BaselineAnalysisService.js'
import type { DataResult, TradingReport } from '../../../src/agents/base/types.js'

const mockLoadLatest = vi.fn()
const mockRunTicker = vi.fn()

function report(asOf: string): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(asOf),
    rawData: [],
    researchFindings: [],
    analysisArtifacts: [],
    finalDecision: { action: 'BUY', confidence: 0.7, reasoning: 'test' },
  }
}

function reportWithOhlcv(asOf: string, latestBarDate: string): TradingReport {
  return {
    ...report(asOf),
    rawData: [
      {
        ticker: 'AAPL',
        market: 'US',
        type: 'ohlcv',
        fetchedAt: new Date(asOf),
        data: [
          {
            date: latestBarDate,
            open: 150,
            high: 155,
            low: 149,
            close: 153,
            volume: 1000000,
          },
        ],
      } satisfies DataResult,
    ],
  }
}

function reportWithSerializedTechnicals(asOf: string, latestBarDate: string, technicalsFetchedAt: string): TradingReport {
  return {
    ...report(asOf),
    rawData: [
      {
        ticker: 'AAPL',
        market: 'US',
        type: 'ohlcv',
        fetchedAt: new Date(asOf),
        data: [
          {
            date: latestBarDate,
            open: 150,
            high: 155,
            low: 149,
            close: 153,
            volume: 1000000,
          },
        ],
      },
      {
        ticker: 'AAPL',
        market: 'US',
        type: 'technicals',
        fetchedAt: technicalsFetchedAt,
        data: { sma50: 150, rsi: 55 },
      },
    ] as unknown as TradingReport['rawData'],
  }
}

describe('BaselineAnalysisService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes when the latest baseline is older than three trading days', async () => {
    mockLoadLatest.mockResolvedValue({
      report: report('2026-04-01T20:00:00.000Z'),
      source: 'db',
      asOf: new Date('2026-04-01T20:00:00.000Z'),
    })
    mockRunTicker.mockResolvedValue(report('2026-04-07T20:00:00.000Z'))

    const service = new BaselineAnalysisService({
      reportLoader: { loadLatest: mockLoadLatest } as never,
      fullAnalysisRunner: { runTicker: mockRunTicker } as never,
    })

    const result = await service.loadBaseline({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T20:00:00.000Z'),
      ragMode: 'memory',
    })

    expect(result.source).toBe('fresh-run')
    expect(result.report.timestamp.toISOString()).toBe('2026-04-07T20:00:00.000Z')
    expect(mockRunTicker).toHaveBeenCalledWith({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T20:00:00.000Z'),
      ragMode: 'memory',
    })
  })

  it('does not refresh when the latest baseline is exactly three trading days old', async () => {
    mockLoadLatest.mockResolvedValue({
      report: report('2026-04-02T20:00:00.000Z'),
      source: 'db',
      asOf: new Date('2026-04-02T20:00:00.000Z'),
    })

    const service = new BaselineAnalysisService({
      reportLoader: { loadLatest: mockLoadLatest } as never,
      fullAnalysisRunner: { runTicker: mockRunTicker } as never,
    })

    const result = await service.loadBaseline({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T20:00:00.000Z'),
      ragMode: 'memory',
    })

    expect(result.source).toBe('db')
    expect(result.asOf.toISOString()).toBe('2026-04-02T20:00:00.000Z')
    expect(mockRunTicker).not.toHaveBeenCalled()
  })

  it('refreshes when no baseline exists', async () => {
    mockLoadLatest.mockResolvedValue(null)
    mockRunTicker.mockResolvedValue(report('2026-04-07T20:00:00.000Z'))

    const service = new BaselineAnalysisService({
      reportLoader: { loadLatest: mockLoadLatest } as never,
      fullAnalysisRunner: { runTicker: mockRunTicker } as never,
    })

    const result = await service.loadBaseline({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T20:00:00.000Z'),
      ragMode: 'memory',
    })

    expect(result.source).toBe('fresh-run')
    expect(mockRunTicker).toHaveBeenCalledWith({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T20:00:00.000Z'),
      ragMode: 'memory',
    })
  })

  it('refreshes when a loaded baseline is missing finalDecision', async () => {
    mockLoadLatest.mockResolvedValue({
      report: {
        ticker: 'AAPL',
        market: 'US',
        timestamp: new Date('2026-04-07T20:00:00.000Z'),
        rawData: [],
        researchFindings: [],
        analysisArtifacts: [],
      },
      source: 'db',
      asOf: new Date('2026-04-07T20:00:00.000Z'),
    })
    mockRunTicker.mockResolvedValue(report('2026-04-08T00:11:21.765Z'))

    const service = new BaselineAnalysisService({
      reportLoader: { loadLatest: mockLoadLatest } as never,
      fullAnalysisRunner: { runTicker: mockRunTicker } as never,
    })

    const result = await service.loadBaseline({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-08T00:11:21.765Z'),
      ragMode: 'memory',
    })

    expect(result.source).toBe('fresh-run')
    expect(mockRunTicker).toHaveBeenCalledWith({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-08T00:11:21.765Z'),
      ragMode: 'memory',
    })
  })

  it('refreshes when a db baseline contains stale OHLCV data', async () => {
    mockLoadLatest.mockResolvedValue({
      report: reportWithOhlcv('2026-04-07T20:00:00.000Z', '2026-03-31T20:00:00.000Z'),
      source: 'db',
      asOf: new Date('2026-04-07T20:00:00.000Z'),
    })
    mockRunTicker.mockResolvedValue(report('2026-04-08T00:11:21.765Z'))

    const service = new BaselineAnalysisService({
      reportLoader: { loadLatest: mockLoadLatest } as never,
      fullAnalysisRunner: { runTicker: mockRunTicker } as never,
    })

    const result = await service.loadBaseline({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-08T00:11:21.765Z'),
      ragMode: 'memory',
    })

    expect(result.source).toBe('fresh-run')
    expect(mockRunTicker).toHaveBeenCalledWith({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-08T00:11:21.765Z'),
      ragMode: 'memory',
    })
  })

  it('refreshes when serialized DB technicals are stale relative to OHLCV', async () => {
    mockLoadLatest.mockResolvedValue({
      report: reportWithSerializedTechnicals(
        '2026-04-07T20:00:00.000Z',
        '2026-04-07T20:00:00.000Z',
        '2026-04-05T00:00:00.000Z',
      ),
      source: 'db',
      asOf: new Date('2026-04-07T20:00:00.000Z'),
    })
    mockRunTicker.mockResolvedValue(report('2026-04-08T00:11:21.765Z'))

    const service = new BaselineAnalysisService({
      reportLoader: { loadLatest: mockLoadLatest } as never,
      fullAnalysisRunner: { runTicker: mockRunTicker } as never,
    })

    const result = await service.loadBaseline({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-08T00:11:21.765Z'),
      ragMode: 'memory',
    })

    expect(result.source).toBe('fresh-run')
    expect(mockRunTicker).toHaveBeenCalledTimes(1)
  })
})
