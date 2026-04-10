import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TradingReport } from '../../src/agents/base/types.js'
import { FullAnalysisRunner } from '../../src/analysis/FullAnalysisRunner.js'

const mockRun = vi.fn()
const mockStartRun = vi.fn()
const mockCompleteRun = vi.fn()
const mockFailRun = vi.fn()

function makeReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-07T14:30:00.000Z'),
    rawData: [],
    researchFindings: [],
    analysisArtifacts: [],
    finalDecision: { action: 'BUY', confidence: 0.72, reasoning: 'aligned signals' },
  }
}

describe('FullAnalysisRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the orchestrator and persists the completed snapshot', async () => {
    mockRun.mockResolvedValue(makeReport())
    mockStartRun.mockResolvedValue('run-123')

    const runner = new FullAnalysisRunner({
      orchestrator: { run: mockRun } as never,
      analysisRunRepository: {
        startRun: mockStartRun,
        completeRun: mockCompleteRun,
        failRun: mockFailRun,
      } as never,
    })

    const result = await runner.runTicker({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T14:30:00.000Z'),
      ragMode: 'memory',
    })

    expect(result.finalDecision?.action).toBe('BUY')
    expect(mockStartRun).toHaveBeenCalledWith({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T14:30:00.000Z'),
      ragMode: 'memory',
    })
    expect(mockCompleteRun).toHaveBeenCalledWith(
      'run-123',
      expect.objectContaining({
        finalAction: 'BUY',
        finalConfidence: 0.72,
        snapshot: expect.objectContaining({ ticker: 'AAPL', market: 'US' }),
      }),
    )
    expect(mockFailRun).not.toHaveBeenCalled()
  })

  it('fails the run when orchestration throws and preserves the original error', async () => {
    const originalError = new Error('orchestrator exploded')
    mockRun.mockRejectedValue(originalError)
    mockStartRun.mockResolvedValue('run-456')
    mockFailRun.mockRejectedValue(new Error('repository failed while failing run'))

    const runner = new FullAnalysisRunner({
      orchestrator: { run: mockRun } as never,
      analysisRunRepository: {
        startRun: mockStartRun,
        completeRun: mockCompleteRun,
        failRun: mockFailRun,
      } as never,
    })

    await expect(
      runner.runTicker({
        ticker: 'AAPL',
        market: 'US',
        asOf: new Date('2026-04-07T14:30:00.000Z'),
        ragMode: 'memory',
      }),
    ).rejects.toThrow(originalError)

    expect(mockFailRun).toHaveBeenCalledWith(
      'run-456',
      expect.objectContaining({
        artifacts: [],
        snapshot: expect.objectContaining({ ticker: 'AAPL', market: 'US' }),
      }),
    )
  })

  it('returns the completed report even when completion persistence fails', async () => {
    const completionError = new Error('completion exploded')
    mockRun.mockResolvedValue(makeReport())
    mockStartRun.mockResolvedValue('run-789')
    mockCompleteRun.mockRejectedValue(completionError)

    const runner = new FullAnalysisRunner({
      orchestrator: { run: mockRun } as never,
      analysisRunRepository: {
        startRun: mockStartRun,
        completeRun: mockCompleteRun,
        failRun: mockFailRun,
      } as never,
    })

    const result = await runner.runTicker({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T14:30:00.000Z'),
      ragMode: 'memory',
    })

    expect(result.finalDecision?.action).toBe('BUY')
    expect(mockFailRun).not.toHaveBeenCalled()
  })

  it('runs without a repository', async () => {
    mockRun.mockResolvedValue(makeReport())

    const runner = new FullAnalysisRunner({
      orchestrator: { run: mockRun } as never,
    })

    const result = await runner.runTicker({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T14:30:00.000Z'),
      ragMode: 'memory',
    })

    expect(result.finalDecision?.action).toBe('BUY')
    expect(mockStartRun).not.toHaveBeenCalled()
    expect(mockCompleteRun).not.toHaveBeenCalled()
    expect(mockFailRun).not.toHaveBeenCalled()
  })
})
