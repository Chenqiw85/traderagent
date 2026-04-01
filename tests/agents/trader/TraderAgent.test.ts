import { describe, it, expect, vi } from 'vitest'
import { TraderAgent } from '../../../src/agents/trader/TraderAgent.js'
import type { Orchestrator } from '../../../src/orchestrator/Orchestrator.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { IVectorStore } from '../../../src/rag/IVectorStore.js'
import type { IEmbedder } from '../../../src/rag/IEmbedder.js'

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

function makeOrchestrator(): Orchestrator {
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
      orchestratorFactory: () => makeOrchestrator(),
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

    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.lessonCount).toBe(1)
    expect(vectorStore.upsert).toHaveBeenCalled()
  })

  it('stops early when test score does not improve enough', async () => {
    const trader = new TraderAgent({
      orchestratorFactory: () => makeOrchestrator(),
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

    expect(results).toHaveLength(2)
  })
})
