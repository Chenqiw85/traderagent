import { describe, it, expect, vi } from 'vitest'
import { ReflectionEngine } from '../../../src/agents/trader/ReflectionEngine.js'
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
    compositeScore: 0.3,
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

describe('ReflectionEngine', () => {
  it('uses realized tier labels in the reflection prompt', async () => {
    const llm = mockLLM(JSON.stringify({
      whatWorked: ['entry timing'],
      whatFailed: ['weak follow-through'],
      adjustments: ['wait for stronger confirmation'],
    }))
    const engine = new ReflectionEngine({ llm })

    await engine.reflect({
      decisions: [makeScoredDecision({ compositeScore: 0.2 })],
      ticker: 'AAPL',
      market: 'US',
      passNumber: 1,
    })

    const chatCall = vi.mocked(llm.chat).mock.calls[0]
    const systemPrompt = chatCall?.[0]?.[0]?.content
    expect(systemPrompt).toContain(
      [
        'Score Breakdown:',
        '- Realized Tier: BUY',
        '- Exact Tier Hit: true',
        '- Tier Distance: 1.000',
        '- Directional: 1.000',
        '- Calibration: 0.800',
        '- Hold Quality: 1.000',
        '- Risk Execution: 0.500',
      ].join('\n'),
    )
    expect(systemPrompt).not.toContain('Target Hit')
    expect(systemPrompt).not.toContain('Hold Penalty')
  })
})
