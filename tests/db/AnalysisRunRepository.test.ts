import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisArtifact, TradingReport } from '../../src/agents/base/types.js'

const mockAnalysisRunCreate = vi.fn()
const mockAnalysisRunUpdate = vi.fn()
const mockAnalysisStageCreateMany = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  prisma: {
    analysisRun: {
      create: mockAnalysisRunCreate,
      update: mockAnalysisRunUpdate,
    },
    analysisStage: {
      createMany: mockAnalysisStageCreateMany,
    },
  },
}))

const { AnalysisRunRepository } = await import('../../src/analysis/AnalysisRunRepository.js')

describe('AnalysisRunRepository', () => {
  const repository = new AnalysisRunRepository()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('startRun returns the created run id', async () => {
    const asOf = new Date('2026-04-05T14:30:00Z')
    mockAnalysisRunCreate.mockResolvedValue({ id: 'run-123' })

    await expect(
      repository.startRun({
        ticker: 'AAPL',
        market: 'US',
        asOf,
        ragMode: 'memory',
      }),
    ).resolves.toBe('run-123')

    expect(mockAnalysisRunCreate).toHaveBeenCalledWith({
      data: {
        ticker: 'AAPL',
        market: 'US',
        asOf,
        ragMode: 'memory',
        status: 'running',
      },
      select: { id: true },
    })
  })

  it('completeRun writes stages and updates the run record', async () => {
    const artifacts: AnalysisArtifact[] = [
      {
        stage: 'research',
        agent: 'researchManager',
        summary: 'Bull thesis remains intact.',
        payload: { stance: 'bull', confidence: 0.74 },
      },
      {
        stage: 'final',
        agent: 'manager',
        summary: 'Buy the breakout with tight risk.',
        payload: { action: 'BUY', confidence: 0.68 },
      },
    ]

    await repository.completeRun('run-123', {
      finalAction: 'BUY',
      finalConfidence: 0.68,
      artifacts,
    })

    expect(mockAnalysisStageCreateMany).toHaveBeenCalledWith({
      data: [
        {
          runId: 'run-123',
          stage: 'research',
          agent: 'researchManager',
          summary: 'Bull thesis remains intact.',
          payload: { stance: 'bull', confidence: 0.74 },
        },
        {
          runId: 'run-123',
          stage: 'final',
          agent: 'manager',
          summary: 'Buy the breakout with tight risk.',
          payload: { action: 'BUY', confidence: 0.68 },
        },
      ],
    })
    expect(mockAnalysisRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-123' },
      data: {
        status: 'completed',
        finalAction: 'BUY',
        finalConfidence: 0.68,
        completedAt: expect.any(Date),
      },
    })
  })

  it('completeRun sanitizes nested undefined fields before writing stage payloads', async () => {
    const artifacts: AnalysisArtifact[] = [
      {
        stage: 'trade',
        agent: 'tradePlanner',
        summary: 'Structured proposal with optional fields omitted.',
        payload: {
          action: 'BUY',
          stopLoss: undefined,
          thesis: {
            summary: 'Momentum improving',
            invalidation: undefined,
            tags: ['breakout', undefined, 'earnings'] as unknown as string[],
          },
          checkpoints: [
            { label: 'entry', price: 182.5, note: undefined },
            undefined,
            { label: 'takeProfit', price: 195 },
          ] as unknown as Array<Record<string, unknown>>,
        },
      },
    ]

    await repository.completeRun('run-789', {
      finalAction: 'BUY',
      finalConfidence: 0.72,
      artifacts,
    })

    expect(mockAnalysisStageCreateMany).toHaveBeenCalledWith({
      data: [
        {
          runId: 'run-789',
          stage: 'trade',
          agent: 'tradePlanner',
          summary: 'Structured proposal with optional fields omitted.',
          payload: {
            action: 'BUY',
            thesis: {
              summary: 'Momentum improving',
              tags: ['breakout', 'earnings'],
            },
            checkpoints: [
              { label: 'entry', price: 182.5 },
              { label: 'takeProfit', price: 195 },
            ],
          },
        },
      ],
    })
  })

  it('completeRun stores a sanitized report snapshot with the final run metadata', async () => {
    const snapshot: TradingReport = {
      ticker: 'AAPL',
      market: 'US',
      timestamp: new Date('2026-04-05T14:30:00Z'),
      rawData: [],
      researchFindings: [],
      analysisArtifacts: [],
      researchThesis: {
        stance: 'bull',
        confidence: 0.74,
        summary: 'Momentum still supports upside.',
        keyDrivers: ['Momentum'],
        keyRisks: ['Valuation'],
        invalidationConditions: ['Lose the breakout'],
        timeHorizon: 'swing',
      },
      traderProposal: {
        action: 'BUY',
        confidence: 0.68,
        summary: 'Buy the breakout.',
        entryLogic: 'Add above prior day high.',
        whyNow: 'Trend and revisions aligned.',
        timeHorizon: 'swing',
        invalidationConditions: ['Close below breakout'],
      },
      riskVerdict: {
        approved: true,
        summary: 'Approved with tighter sizing.',
        blockers: [],
        requiredAdjustments: ['Keep size under 8%'],
      },
      finalDecision: {
        action: 'BUY',
        confidence: 0.68,
        reasoning: 'Momentum remains constructive.',
      },
    }

    await repository.completeRun('run-snapshot', {
      finalAction: 'BUY',
      finalConfidence: 0.68,
      artifacts: [],
      snapshot,
    })

    expect(mockAnalysisRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-snapshot' },
      data: {
        status: 'completed',
        finalAction: 'BUY',
        finalConfidence: 0.68,
        snapshot: {
          ticker: 'AAPL',
          market: 'US',
          timestamp: '2026-04-05T14:30:00.000Z',
          rawData: [],
          researchFindings: [],
          analysisArtifacts: [],
          researchThesis: {
            stance: 'bull',
            confidence: 0.74,
            summary: 'Momentum still supports upside.',
            keyDrivers: ['Momentum'],
            keyRisks: ['Valuation'],
            invalidationConditions: ['Lose the breakout'],
            timeHorizon: 'swing',
          },
          traderProposal: {
            action: 'BUY',
            confidence: 0.68,
            summary: 'Buy the breakout.',
            entryLogic: 'Add above prior day high.',
            whyNow: 'Trend and revisions aligned.',
            timeHorizon: 'swing',
            invalidationConditions: ['Close below breakout'],
          },
          riskVerdict: {
            approved: true,
            summary: 'Approved with tighter sizing.',
            blockers: [],
            requiredAdjustments: ['Keep size under 8%'],
          },
          finalDecision: {
            action: 'BUY',
            confidence: 0.68,
            reasoning: 'Momentum remains constructive.',
          },
        },
        completedAt: expect.any(Date),
      },
    })
  })

  it('completeRun does not explode when artifacts is empty', async () => {
    await expect(
      repository.completeRun('run-456', {
        finalAction: 'HOLD',
        finalConfidence: 0.5,
        artifacts: [],
      }),
    ).resolves.toBeUndefined()

    expect(mockAnalysisStageCreateMany).not.toHaveBeenCalled()
    expect(mockAnalysisRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-456' },
      data: {
        status: 'completed',
        finalAction: 'HOLD',
        finalConfidence: 0.5,
        completedAt: expect.any(Date),
      },
    })
  })

  it('failRun marks the run as failed', async () => {
    await expect(repository.failRun('run-999')).resolves.toBeUndefined()

    expect(mockAnalysisRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-999' },
      data: {
        status: 'failed',
        completedAt: expect.any(Date),
      },
    })
  })

  it('failRun persists partial artifacts and a snapshot before marking failure', async () => {
    const artifacts: AnalysisArtifact[] = [
      {
        stage: 'research',
        agent: 'researchManager',
        summary: 'Bull thesis still intact.',
        payload: { stance: 'bull', confidence: 0.72 },
      },
    ]

    await repository.failRun('run-failed', {
      artifacts,
      snapshot: {
        ticker: 'AAPL',
        market: 'US',
        timestamp: new Date('2026-04-05T14:31:00Z'),
        rawData: [],
        researchFindings: [],
        analysisArtifacts: artifacts,
        researchThesis: {
          stance: 'bull',
          confidence: 0.72,
          summary: 'Bull thesis still intact.',
          keyDrivers: ['Momentum'],
          keyRisks: ['Valuation'],
          invalidationConditions: ['Lose the breakout'],
          timeHorizon: 'swing',
        },
      },
    })

    expect(mockAnalysisStageCreateMany).toHaveBeenCalledWith({
      data: [
        {
          runId: 'run-failed',
          stage: 'research',
          agent: 'researchManager',
          summary: 'Bull thesis still intact.',
          payload: { stance: 'bull', confidence: 0.72 },
        },
      ],
    })
    expect(mockAnalysisRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-failed' },
      data: {
        status: 'failed',
        snapshot: {
          ticker: 'AAPL',
          market: 'US',
          timestamp: '2026-04-05T14:31:00.000Z',
          rawData: [],
          researchFindings: [],
          analysisArtifacts: [
            {
              stage: 'research',
              agent: 'researchManager',
              summary: 'Bull thesis still intact.',
              payload: { stance: 'bull', confidence: 0.72 },
            },
          ],
          researchThesis: {
            stance: 'bull',
            confidence: 0.72,
            summary: 'Bull thesis still intact.',
            keyDrivers: ['Momentum'],
            keyRisks: ['Valuation'],
            invalidationConditions: ['Lose the breakout'],
            timeHorizon: 'swing',
          },
        },
        completedAt: expect.any(Date),
      },
    })
  })
})
