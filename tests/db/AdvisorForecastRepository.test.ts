import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateMany = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  prisma: {
    advisorForecast: {
      createMany: mockCreateMany,
    },
  },
}))

const { AdvisorForecastRepository } = await import('../../src/agents/advisor/AdvisorForecastRepository.js')

describe('AdvisorForecastRepository', () => {
  const repository = new AdvisorForecastRepository()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists one row per forecast-backed advisory', async () => {
    await repository.saveMany({
      issuedAt: new Date('2026-04-07T20:00:00.000Z'),
      advisories: [
        {
          ticker: 'AAPL',
          market: 'US',
          decision: {
            action: 'BUY',
            confidence: 0.72,
            reasoning: 'Forecast-compatible decision shim.',
          },
          forecast: {
            predictedDirection: 'up',
            referencePrice: 183,
            targetPrice: 184,
            targetSession: '2026-04-08',
            confidence: 0.72,
            reasoning: 'Momentum strengthened the baseline thesis.',
            baselineAction: 'BUY',
            baselineReferencePrice: 183,
            changeFromBaseline: 'strengthened',
          },
          baselineAsOf: new Date('2026-04-07T20:00:00.000Z'),
          baselineSource: 'db',
          baselineDecision: {
            action: 'BUY',
            confidence: 0.7,
            reasoning: 'Baseline decision remains constructive.',
          },
          keyFindings: [],
        },
      ],
    })

    expect(mockCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          ticker: 'AAPL',
          market: 'US',
          issuedAt: new Date('2026-04-07T20:00:00.000Z'),
          targetSession: new Date('2026-04-08T00:00:00.000Z'),
          predictedDirection: 'up',
          referencePrice: 183,
          targetPrice: 184,
          confidence: 0.72,
          baselineAction: 'BUY',
          baselineAsOf: new Date('2026-04-07T20:00:00.000Z'),
          changeFromBaseline: 'strengthened',
        }),
      ],
    })
  })

  it('ignores advisories that do not have the required forecast context', async () => {
    await repository.saveMany({
      issuedAt: new Date('2026-04-07T20:00:00.000Z'),
      advisories: [
        {
          ticker: 'AAPL',
          market: 'US',
          decision: {
            action: 'BUY',
            confidence: 0.7,
            reasoning: 'Legacy advisory.',
          },
          keyFindings: [],
        },
      ],
    })

    expect(mockCreateMany).not.toHaveBeenCalled()
  })
})
