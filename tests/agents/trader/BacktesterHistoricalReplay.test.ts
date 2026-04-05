import { describe, it, expect, vi } from 'vitest'
import { Backtester } from '../../../src/agents/trader/Backtester.js'
import { CompositeScorer } from '../../../src/agents/trader/CompositeScorer.js'
import type { Orchestrator } from '../../../src/orchestrator/Orchestrator.js'

describe('Backtester historical replay', () => {
  it('passes a historical timestamp into the pipeline for each replayed day', async () => {
    const run = vi.fn().mockResolvedValue({
      ticker: 'AAPL',
      market: 'US',
      timestamp: new Date('2025-06-01T00:00:00.000Z'),
      rawData: [],
      researchFindings: [],
      finalDecision: {
        action: 'BUY',
        confidence: 0.8,
        reasoning: 'test',
      },
    })
    const orchestrator = { run } as unknown as Orchestrator
    const scorer = new CompositeScorer({ evaluationDays: 2 })
    const bars = [
      { date: '2025-06-01T00:00:00.000Z', open: 100, high: 101, low: 99, close: 100, volume: 1 },
      { date: '2025-06-02T00:00:00.000Z', open: 101, high: 102, low: 100, close: 101, volume: 1 },
      { date: '2025-06-03T00:00:00.000Z', open: 102, high: 103, low: 101, close: 102, volume: 1 },
      { date: '2025-06-04T00:00:00.000Z', open: 103, high: 104, low: 102, close: 103, volume: 1 },
    ]

    const backtester = new Backtester({
      orchestratorFactory: () => orchestrator,
      scorer,
      ticker: 'AAPL',
      market: 'US',
      ohlcvBars: bars,
      evaluationDays: 2,
    })

    await backtester.replay(new Date('2025-06-01T00:00:00.000Z'), new Date('2025-06-02T00:00:00.000Z'))

    expect(run.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      timestamp: new Date('2025-06-01T00:00:00.000Z'),
    }))
    expect(run.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
      timestamp: new Date('2025-06-02T00:00:00.000Z'),
    }))
  })
})
