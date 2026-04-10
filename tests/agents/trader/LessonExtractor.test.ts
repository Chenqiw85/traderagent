import { describe, it, expect, vi } from 'vitest'
import { LessonExtractor } from '../../../src/agents/trader/LessonExtractor.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { ScoredDecision } from '../../../src/agents/trader/types.js'

function makeScoredDecision(overrides: Partial<ScoredDecision> = {}): ScoredDecision {
  return {
    date: new Date('2025-06-15'),
    decision: {
      action: 'BUY',
      confidence: 0.8,
      reasoning: 'RSI oversold with positive MACD crossover',
      stopLoss: 95,
      takeProfit: 110,
    },
    actualReturn: 0.05,
    hitTakeProfit: false,
    hitStopLoss: false,
    breakdown: {
      realizedTier: 'BUY',
      exactTierHit: true,
      tierDistanceScore: 1,
      directionalScore: 1,
      calibrationScore: 0.8,
      holdQualityScore: 1,
      riskExecutionScore: 0.5,
    },
    compositeScore: 0.8,
    ...overrides,
  }
}

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

describe('LessonExtractor', () => {
  it('extracts lessons from scored decisions', async () => {
    const llmResponse = JSON.stringify([
      {
        condition: 'RSI oversold + declining volume',
        lesson: 'BUY signals with declining volume are unreliable',
        evidence: '5 out of 7 similar conditions resulted in losses',
        confidence: 0.85,
      },
    ])

    const llm = mockLLM(llmResponse)
    const extractor = new LessonExtractor({ llm })

    const decisions = [
      makeScoredDecision({ compositeScore: 0.2 }),
      makeScoredDecision({ compositeScore: 0.9 }),
    ]

    const lessons = await extractor.extract({
      decisions,
      ticker: 'AAPL',
      market: 'US',
      passNumber: 1,
    })

    expect(lessons).toHaveLength(1)
    expect(lessons[0]?.condition).toBe('RSI oversold + declining volume')
    expect(lessons[0]?.lesson).toBe('BUY signals with declining volume are unreliable')
    expect(lessons[0]?.ticker).toBe('AAPL')
    expect(lessons[0]?.market).toBe('US')
    expect(lessons[0]?.passNumber).toBe(1)
    expect(lessons[0]?.id).toBeDefined()
  })

  it('returns empty array when LLM returns invalid JSON', async () => {
    const llm = mockLLM('I cannot parse this data properly')
    const extractor = new LessonExtractor({ llm })

    const lessons = await extractor.extract({
      decisions: [makeScoredDecision()],
      ticker: 'AAPL',
      market: 'US',
      passNumber: 1,
    })

    expect(lessons).toEqual([])
  })

  it('includes decision summary in LLM prompt', async () => {
    const llm = mockLLM('[]')
    const extractor = new LessonExtractor({ llm })

    await extractor.extract({
      decisions: [makeScoredDecision({ compositeScore: 0.3 })],
      ticker: 'AAPL',
      market: 'US',
      passNumber: 1,
    })

    const chatCall = vi.mocked(llm.chat).mock.calls[0]
    const systemPrompt = chatCall?.[0]?.[0]?.content
    expect(systemPrompt).toContain('AAPL')
    expect(systemPrompt).toContain('Summary: 1 decisions, 1 directional wins, 0 directional losses, 0 holds')
    expect(systemPrompt).toContain('Exact tier hits: 1')
    expect(systemPrompt).toContain(
      'realized=BUY exact=true dist=1.000 dir=1.000 cal=0.800 hold=1.000 risk=0.500',
    )
    expect(systemPrompt).not.toContain('targetHit')
    expect(systemPrompt).not.toContain('holdPenalty')
  })
})
