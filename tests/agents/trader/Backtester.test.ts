import { describe, it, expect, vi } from 'vitest'
import { Backtester } from '../../../src/agents/trader/Backtester.js'
import type { Orchestrator } from '../../../src/orchestrator/Orchestrator.js'
import type { TradingReport, Decision, Market } from '../../../src/agents/base/types.js'
import { CompositeScorer } from '../../../src/agents/trader/CompositeScorer.js'

function makeReport(
  ticker: string,
  market: Market,
  decision: Partial<Decision> = {},
): TradingReport {
  return {
    ticker,
    market,
    timestamp: new Date(),
    rawData: [],
    researchFindings: [],
    finalDecision: {
      action: 'BUY',
      confidence: 0.8,
      reasoning: 'test',
      stopLoss: 95,
      takeProfit: 110,
      ...decision,
    },
  }
}

function mockOrchestrator(report: TradingReport): Orchestrator {
  return {
    run: vi.fn().mockResolvedValue(report),
  } as unknown as Orchestrator
}

describe('Backtester', () => {
  it('replays each trading day and returns scored decisions', async () => {
    const report = makeReport('AAPL', 'US', { action: 'BUY', confidence: 0.8 })
    const orchestrator = mockOrchestrator(report)
    const scorer = new CompositeScorer({ evaluationDays: 5 })

    const ohlcvBars = Array.from({ length: 10 }, (_, i) => ({
      date: new Date(2025, 5, i + 1).toISOString(),
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 1000000,
    }))

    const backtester = new Backtester({
      orchestrator,
      scorer,
      ticker: 'AAPL',
      market: 'US',
      ohlcvBars,
      evaluationDays: 5,
    })

    const results = await backtester.replay(new Date(2025, 5, 1), new Date(2025, 5, 5))

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.decision.action).toBe('BUY')
    expect(results[0]?.compositeScore).toBeGreaterThanOrEqual(0)
    expect(results[0]?.compositeScore).toBeLessThanOrEqual(1)
  })

  it('skips days where pipeline fails and continues', async () => {
    const orchestrator = {
      run: vi
        .fn()
        .mockRejectedValueOnce(new Error('data missing'))
        .mockResolvedValue(makeReport('AAPL', 'US')),
    } as unknown as Orchestrator

    const scorer = new CompositeScorer({ evaluationDays: 5 })

    const ohlcvBars = Array.from({ length: 15 }, (_, i) => ({
      date: new Date(2025, 5, i + 1).toISOString(),
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 1000000,
    }))

    const backtester = new Backtester({
      orchestrator,
      scorer,
      ticker: 'AAPL',
      market: 'US',
      ohlcvBars,
      evaluationDays: 5,
    })

    const results = await backtester.replay(new Date(2025, 5, 1), new Date(2025, 5, 10))

    expect(results.length).toBeGreaterThan(0)
  })

  it('returns empty when no evaluation window available', async () => {
    const orchestrator = mockOrchestrator(makeReport('AAPL', 'US'))
    const scorer = new CompositeScorer({ evaluationDays: 5 })

    const ohlcvBars = [
      { date: '2025-06-01', open: 100, high: 101, low: 99, close: 100, volume: 1000000 },
      { date: '2025-06-02', open: 101, high: 102, low: 100, close: 101, volume: 1000000 },
      { date: '2025-06-03', open: 102, high: 103, low: 101, close: 102, volume: 1000000 },
    ]

    const backtester = new Backtester({
      orchestrator,
      scorer,
      ticker: 'AAPL',
      market: 'US',
      ohlcvBars,
      evaluationDays: 5,
    })

    const results = await backtester.replay(new Date(2025, 5, 1), new Date(2025, 5, 3))

    expect(results).toEqual([])
  })
})
