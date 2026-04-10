import { describe, it, expect, vi } from 'vitest'
import { TraderAgent } from '../../../src/agents/trader/TraderAgent.js'
import type { Orchestrator } from '../../../src/orchestrator/Orchestrator.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { IVectorStore } from '../../../src/rag/IVectorStore.js'
import type { IEmbedder } from '../../../src/rag/IEmbedder.js'

vi.mock('../../../src/agents/trader/ReflectionEngine.js', () => ({
  ReflectionEngine: class {
    async reflect(input: { ticker: string; market: string; passNumber: number }) {
      return [
        {
          id: `reflection-${input.passNumber}`,
          ticker: input.ticker,
          market: String(input.market),
          date: '2025-01-01',
          action: 'SELL',
          actualReturn: -0.04,
          compositeScore: 0.2,
          whatWorked: ['something'],
          whatFailed: ['something else'],
          adjustments: ['tighten entry', 'reduce size'],
          passNumber: input.passNumber,
        },
      ]
    }
  },
}))

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function mockVectorStore(): IVectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function mockEmbedder(): IEmbedder {
  return {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  }
}

function makeOrchestrator(decisionOverrides: Record<string, unknown> = {}): Orchestrator {
  return {
    run: vi.fn().mockResolvedValue({
      ticker: 'AAPL',
      market: 'US',
      timestamp: new Date(),
      rawData: [],
      researchFindings: [],
      finalDecision: {
        action: 'BUY',
        confidence: 0.8,
        reasoning: 'test decision',
        stopLoss: 95,
        takeProfit: 110,
        ...decisionOverrides,
      },
      lessonRetrievals: [
        {
          lessonId: 'lesson-a',
          agent: 'bull',
          perspective: 'bull',
          source: 'extractor',
          ticker: 'AAPL',
          market: 'US',
          asOf: new Date('2025-01-01T00:00:00.000Z'),
          query: 'bull setup',
          rank: 1,
        },
      ],
    }),
  } as unknown as Orchestrator
}

function makeOrchestratorWithoutLessons(decisionOverrides: Record<string, unknown> = {}): Orchestrator {
  return {
    run: vi.fn().mockResolvedValue({
      ticker: 'AAPL',
      market: 'US',
      timestamp: new Date(),
      rawData: [],
      researchFindings: [],
      finalDecision: {
        action: 'BUY',
        confidence: 0.8,
        reasoning: 'test decision',
        stopLoss: 95,
        takeProfit: 110,
        ...decisionOverrides,
      },
      lessonRetrievals: [],
    }),
  } as unknown as Orchestrator
}

function makeOverweightOrchestrator(): Orchestrator {
  return {
    run: vi.fn().mockResolvedValue({
      ticker: 'AAPL',
      market: 'US',
      timestamp: new Date(),
      rawData: [],
      researchFindings: [],
      finalDecision: {
        action: 'OVERWEIGHT',
        confidence: 0.7,
        reasoning: 'test decision',
        stopLoss: 95,
        takeProfit: 110,
      },
    }),
  } as unknown as Orchestrator
}

describe('TraderAgent', () => {
  it('runs training passes and stores extracted lessons', async () => {
    const vectorStore = mockVectorStore()
    const embedder = mockEmbedder()
    const lessonLLM = mockLLM(
      JSON.stringify([
        {
          condition: 'RSI oversold',
          lesson: 'Wait for confirmation',
          evidence: '3 of 4 weak setups failed',
          confidence: 0.8,
        },
      ]),
    )

    const trader = new TraderAgent({
      orchestratorFactory: (_cutoff: Date) => makeOrchestrator(),
      lessonLLM,
      vectorStore,
      embedder,
      ohlcvBars: Array.from({ length: 50 }, (_, i) => ({
        date: new Date(2025, 0, i + 1).toISOString(),
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100 + i,
        volume: 1000000,
      })),
    })

    const results = await trader.train({
      ticker: 'AAPL',
      market: 'US',
      maxPasses: 2,
      lookbackMonths: 12,
      evaluationDays: 5,
      earlyStopThreshold: 0.5,
      earlyStopPatience: 2,
    })

    expect(results.passes.length).toBeGreaterThan(0)
    expect(results.passes[0]?.lessonCount).toBe(1)
    expect(vectorStore.upsert).toHaveBeenCalled()
    const extractedDocs = vi.mocked(vectorStore.upsert).mock.calls[0]?.[0] ?? []
    expect(extractedDocs[0]?.metadata).toEqual(
      expect.objectContaining({
        source: 'extractor',
        perspective: 'shared',
      }),
    )
  })

  it('stops early when test score does not improve enough', async () => {
    const trader = new TraderAgent({
      orchestratorFactory: (_cutoff: Date) => makeOrchestrator(),
      lessonLLM: mockLLM('[]'),
      ohlcvBars: Array.from({ length: 50 }, (_, i) => ({
        date: new Date(2025, 0, i + 1).toISOString(),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000000,
      })),
    })

    const results = await trader.train({
      ticker: 'AAPL',
      market: 'US',
      maxPasses: 4,
      lookbackMonths: 12,
      evaluationDays: 5,
      earlyStopThreshold: 0.01,
      earlyStopPatience: 1,
    })

    expect(results.passes).toHaveLength(2)
  })

  it('extracts lessons from train decisions only', async () => {
    const lessonLLM = mockLLM('[]')
    const trader = new TraderAgent({
      orchestratorFactory: (_cutoff: Date) => makeOrchestrator(),
      lessonLLM,
      ohlcvBars: Array.from({ length: 50 }, (_, i) => ({
        date: new Date(2025, 0, i + 1).toISOString(),
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100 + i,
        volume: 1000000,
      })),
    })

    await trader.train({
      ticker: 'AAPL',
      market: 'US',
      maxPasses: 1,
      lookbackMonths: 12,
      evaluationDays: 5,
      earlyStopThreshold: 0.5,
      earlyStopPatience: 2,
    })

    const prompt = vi.mocked(lessonLLM.chat).mock.calls[0]?.[0]?.[0]?.content ?? ''
    expect(prompt).toContain('Summary: 35 decisions')
    expect(prompt).not.toContain('Summary: 45 decisions')
  })

  it('counts tier-aligned OVERWEIGHT decisions as wins in window summaries', async () => {
    const trader = new TraderAgent({
      orchestratorFactory: (_cutoff: Date) => makeOverweightOrchestrator(),
      lessonLLM: mockLLM('[]'),
      ohlcvBars: Array.from({ length: 50 }, (_, i) => ({
        date: new Date(2025, 0, i + 1).toISOString(),
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100 + i,
        volume: 1000000,
      })),
    })

    const results = await trader.train({
      ticker: 'AAPL',
      market: 'US',
      maxPasses: 1,
      lookbackMonths: 12,
      evaluationDays: 5,
      earlyStopThreshold: 0.5,
      earlyStopPatience: 2,
    })

    expect(results.passes[0]?.windows[0]?.winRate).toBe(1)
  })

  it('stores unique lesson ids with pass context for reflection adjustments', async () => {
    const vectorStore = mockVectorStore()
    const embedder = mockEmbedder()
    vi.mocked(embedder.embedBatch).mockResolvedValue([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ])
    const trader = new TraderAgent({
      orchestratorFactory: (_cutoff: Date) =>
        ({
          run: vi.fn().mockResolvedValue({
            ticker: 'AAPL',
            market: 'US',
            timestamp: new Date(),
            rawData: [],
            researchFindings: [],
            finalDecision: {
              action: 'SELL',
              confidence: 0.2,
              reasoning: 'test decision',
              stopLoss: 120,
              takeProfit: 80,
            },
          }),
        }) as unknown as Orchestrator,
      lessonLLM: mockLLM('[]'),
      vectorStore,
      embedder,
      ohlcvBars: Array.from({ length: 6 }, (_, i) => ({
        date: new Date(2025, 0, i + 1).toISOString(),
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100 + i,
        volume: 1000000,
      })),
    })

    await trader.train({
      ticker: 'AAPL',
      market: 'US',
      maxPasses: 2,
      lookbackMonths: 12,
      evaluationDays: 5,
      earlyStopThreshold: 0.5,
      earlyStopPatience: 2,
    })

    const docs = vi
      .mocked(vectorStore.upsert)
      .mock.calls.flatMap((call) => call[0] ?? [])
    const ids = docs.map((doc) => doc.id)

    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    expect(ids.every((id) => id.includes('pass-1') || id.includes('pass-2'))).toBe(true)
    expect(ids.some((id) => id.includes('pass-1'))).toBe(true)
    expect(ids.some((id) => id.includes('pass-2'))).toBe(true)

    const reflectionDocs = vi
      .mocked(vectorStore.upsert)
      .mock.calls.flatMap((call) => call[0] ?? [])
      .filter((doc) => doc.id.includes('adj-'))
    expect(reflectionDocs).not.toHaveLength(0)
    expect(reflectionDocs.every((doc) => doc.metadata?.['source'] === 'reflection')).toBe(true)
    expect(reflectionDocs.every((doc) => doc.metadata?.['perspective'] === 'shared')).toBe(true)
  })

  it('includes credibility summaries on both train and test windows', async () => {
    const trader = new TraderAgent({
      orchestratorFactory: (_cutoff: Date) =>
        makeOrchestrator({
          stopLoss: 1,
          takeProfit: 1000,
        }),
      lessonLLM: mockLLM('[]'),
      ohlcvBars: Array.from({ length: 10 }, (_, i) => {
        const close = 100 + i * 10
        return {
          date: new Date(2025, 0, i + 1).toISOString(),
          open: close,
          high: close + 1,
          low: close - 1,
          close,
          volume: 1000000,
        }
      }),
    })

    const results = await trader.train({
      ticker: 'AAPL',
      market: 'US',
      maxPasses: 1,
      lookbackMonths: 12,
      evaluationDays: 1,
      earlyStopThreshold: 0.5,
      earlyStopPatience: 2,
    })

    expect(results.passes[0]?.windows[0]?.credibility).toEqual({
      exactTierHitRate: 1,
      directionalHitRate: 1,
      avgCompositeScore: 0.86,
      highConfidenceMissCount: 0,
      scoreWithLessons: 0.86,
      scoreWithoutLessons: null,
      retrievalRateByAgent: {
        bull: 1,
      },
      calibrationBuckets: [
        {
          label: '0.00-0.19',
          minConfidence: 0,
          maxConfidence: 0.19,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.20-0.39',
          minConfidence: 0.2,
          maxConfidence: 0.39,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.40-0.59',
          minConfidence: 0.4,
          maxConfidence: 0.59,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.60-0.79',
          minConfidence: 0.6,
          maxConfidence: 0.79,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.80-1.00',
          minConfidence: 0.8,
          maxConfidence: 1,
          decisionCount: 7,
          exactTierHitRate: 1,
          directionalHitRate: 1,
          avgCompositeScore: 0.86,
        },
      ],
      helpfulLessons: [],
      harmfulLessons: [],
    })
    expect(results.passes[0]?.windows[1]?.credibility).toEqual({
      exactTierHitRate: 1,
      directionalHitRate: 1,
      avgCompositeScore: 0.86,
      highConfidenceMissCount: 0,
      scoreWithLessons: 0.86,
      scoreWithoutLessons: null,
      retrievalRateByAgent: {
        bull: 1,
      },
      calibrationBuckets: [
        {
          label: '0.00-0.19',
          minConfidence: 0,
          maxConfidence: 0.19,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.20-0.39',
          minConfidence: 0.2,
          maxConfidence: 0.39,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.40-0.59',
          minConfidence: 0.4,
          maxConfidence: 0.59,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.60-0.79',
          minConfidence: 0.6,
          maxConfidence: 0.79,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.80-1.00',
          minConfidence: 0.8,
          maxConfidence: 1,
          decisionCount: 2,
          exactTierHitRate: 1,
          directionalHitRate: 1,
          avgCompositeScore: 0.86,
        },
      ],
      helpfulLessons: [],
      harmfulLessons: [],
    })
  })

  it('reports no-lesson cohorts through backtester and trader summaries', async () => {
    const trader = new TraderAgent({
      orchestratorFactory: (_cutoff: Date) =>
        makeOrchestratorWithoutLessons({
          stopLoss: 1,
          takeProfit: 1000,
        }),
      lessonLLM: mockLLM('[]'),
      ohlcvBars: Array.from({ length: 10 }, (_, i) => {
        const close = 100 + i * 10
        return {
          date: new Date(2025, 0, i + 1).toISOString(),
          open: close,
          high: close + 1,
          low: close - 1,
          close,
          volume: 1000000,
        }
      }),
    })

    const results = await trader.train({
      ticker: 'AAPL',
      market: 'US',
      maxPasses: 1,
      lookbackMonths: 12,
      evaluationDays: 1,
      earlyStopThreshold: 0.5,
      earlyStopPatience: 2,
    })

    expect(results.passes[0]?.windows[0]?.credibility.scoreWithLessons).toBeNull()
    expect(results.passes[0]?.windows[0]?.credibility.scoreWithoutLessons).toBe(0.86)
    expect(results.passes[0]?.windows[1]?.credibility.scoreWithLessons).toBeNull()
    expect(results.passes[0]?.windows[1]?.credibility.scoreWithoutLessons).toBe(0.86)
  })
})
