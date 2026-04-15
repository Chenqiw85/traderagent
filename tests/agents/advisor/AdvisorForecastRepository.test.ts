import { describe, expect, it, beforeEach, vi } from 'vitest'
import { AdvisorForecastRepository } from '../../../src/agents/advisor/AdvisorForecastRepository.js'

const createMany = vi.fn().mockResolvedValue(undefined)
const findMany = vi.fn()
const update = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../src/db/client.js', () => ({
  prisma: {
    advisorForecast: {
      createMany: (args: unknown) => createMany(args),
      findMany: (args: unknown) => findMany(args),
      update: (args: unknown) => update(args),
    },
  },
}))

function makeAdvisory(overrides: Partial<{ abstain: boolean; atrRange: [number, number] }> = {}) {
  const common = {
    ticker: 'AAPL',
    market: 'US' as const,
    decision: { action: 'BUY', confidence: 0.6, reasoning: 'r' } as const,
    keyFindings: [],
    baselineAsOf: new Date('2026-04-10T00:00:00Z'),
    baselineSource: 'db' as const,
    baselineDecision: { action: 'BUY' as const, confidence: 0.6, reasoning: 'r' },
  }
  if (overrides.abstain) {
    return {
      ...common,
      forecast: {
        predictedDirection: 'abstain' as const,
        abstainReason: 'malformed-llm-output' as const,
        referencePrice: 180,
        targetSession: '2026-04-13',
        baselineAction: 'BUY' as const,
      },
    }
  }
  return {
    ...common,
    forecast: {
      predictedDirection: 'up' as const,
      referencePrice: 180,
      targetPrice: 182,
      targetSession: '2026-04-13',
      confidence: 0.7,
      reasoning: 'r',
      baselineAction: 'BUY' as const,
      changeFromBaseline: 'strengthened' as const,
      atrRange: overrides.atrRange,
    },
  }
}

describe('AdvisorForecastRepository', () => {
  beforeEach(() => {
    createMany.mockClear()
    findMany.mockClear()
    update.mockClear()
  })

  it('saveMany persists atrRangeLow/High from forecast input', async () => {
    const repo = new AdvisorForecastRepository()
    await repo.saveMany({
      issuedAt: new Date('2026-04-12T13:00:00Z'),
      advisories: [makeAdvisory({ atrRange: [178, 184] })],
    })
    expect(createMany).toHaveBeenCalledOnce()
    const row = (createMany.mock.calls[0][0] as { data: any[] }).data[0]
    expect(row.atrRangeLow).toBe(178)
    expect(row.atrRangeHigh).toBe(184)
  })

  it('saveMany persists abstain forecasts with marker fields', async () => {
    const repo = new AdvisorForecastRepository()
    await repo.saveMany({
      issuedAt: new Date('2026-04-12T13:00:00Z'),
      advisories: [makeAdvisory({ abstain: true })],
    })
    const row = (createMany.mock.calls[0][0] as { data: any[] }).data[0]
    expect(row.predictedDirection).toBe('abstain')
    expect(row.confidence).toBe(0)
    expect(row.targetPrice).toBe(180)
    expect(row.atrRangeLow).toBeNull()
    expect(row.atrRangeHigh).toBeNull()
  })

  it('findUnscored filters by targetSession and pending status', async () => {
    findMany.mockResolvedValueOnce([])
    const repo = new AdvisorForecastRepository()
    await repo.findUnscored(new Date('2026-04-12T00:00:00Z'))
    expect(findMany).toHaveBeenCalledWith({
      where: {
        targetSession: { lte: new Date('2026-04-12T00:00:00Z') },
        scoringStatus: null,
        predictedDirection: { not: 'abstain' },
      },
      orderBy: { targetSession: 'asc' },
    })
  })

  it('findUnscored excludes abstain rows', async () => {
    findMany.mockResolvedValueOnce([])
    const repo = new AdvisorForecastRepository()
    await repo.findUnscored(new Date('2026-04-12T00:00:00Z'))
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(args.where['predictedDirection']).toEqual({ not: 'abstain' })
  })

  it('markScored writes all scoring fields atomically', async () => {
    const repo = new AdvisorForecastRepository()
    await repo.markScored('row-id', {
      actualClose: 183.5,
      actualDirection: 'up',
      status: 'scored',
    })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'row-id' },
      data: expect.objectContaining({
        actualClose: 183.5,
        actualDirection: 'up',
        scoringStatus: 'scored',
        scoredAt: expect.any(Date),
      }),
    })
  })

  it('markScored supports no-data status with null close/direction', async () => {
    const repo = new AdvisorForecastRepository()
    await repo.markScored('row-id', {
      actualClose: null,
      actualDirection: null,
      status: 'no-data',
    })
    const args = update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(args.data.actualClose).toBeNull()
    expect(args.data.actualDirection).toBeNull()
    expect(args.data.scoringStatus).toBe('no-data')
  })

  it('findRecentScored returns rows filtered to status=scored, descending by issuedAt', async () => {
    findMany.mockResolvedValueOnce([])
    const repo = new AdvisorForecastRepository()
    await repo.findRecentScored('AAPL', 'US', 20)
    expect(findMany).toHaveBeenCalledWith({
      where: {
        ticker: 'AAPL',
        market: 'US',
        scoringStatus: 'scored',
        actualClose: { not: null },
      },
      orderBy: { issuedAt: 'desc' },
      take: 20,
    })
  })
})
