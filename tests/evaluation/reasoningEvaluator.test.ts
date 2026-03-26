// tests/evaluation/reasoningEvaluator.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ReasoningEvaluator } from '../../src/evaluation/ReasoningEvaluator.js'
import type { ILLMProvider } from '../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function reportWithDecision(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: ['Strong earnings growth'], confidence: 0.8 },
    ],
    finalDecision: { action: 'BUY', confidence: 0.75, reasoning: 'Bull evidence is strong' },
  }
}

describe('ReasoningEvaluator', () => {
  it('returns EvaluationResult with score averaged over three dimensions', async () => {
    const llm = mockLLM(
      '{"logicalConsistency":0.8,"evidenceQuality":0.7,"confidenceCalibration":0.9,"notes":"Good analysis"}'
    )
    const evaluator = new ReasoningEvaluator({ llm })
    const result = await evaluator.evaluate(reportWithDecision())
    expect(result.score).toBeCloseTo((0.8 + 0.7 + 0.9) / 3)
    expect(result.breakdown.logicalConsistency).toBe(0.8)
    expect(result.breakdown.evidenceQuality).toBe(0.7)
    expect(result.breakdown.confidenceCalibration).toBe(0.9)
    expect(result.notes).toBe('Good analysis')
  })

  it('falls back to default 0.5 scores on malformed LLM response', async () => {
    const evaluator = new ReasoningEvaluator({ llm: mockLLM('bad json') })
    const result = await evaluator.evaluate(reportWithDecision())
    expect(result.score).toBeCloseTo(0.5)
  })
})
