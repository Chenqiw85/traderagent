import { describe, it, expect, vi } from 'vitest'
import { FundamentalsAnalyst } from '../../../src/agents/researcher/FundamentalsAnalyst.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function emptyReport(): TradingReport {
  return { ticker: 'AAPL', market: 'US', timestamp: new Date(), rawData: [], researchFindings: [] }
}

describe('FundamentalsAnalyst', () => {
  it('has correct name and role', () => {
    const agent = new FundamentalsAnalyst({ llm: mockLLM('{}') })
    expect(agent.name).toBe('fundamentalsAnalyst')
    expect(agent.role).toBe('researcher')
  })

  it('captures fundamentalScore and keyMetrics', async () => {
    const llm = mockLLM(
      '{"stance":"bull","fundamentalScore":78,"keyMetrics":{"PE":25,"revenueGrowth":0.12,"profitMargin":0.24},"evidence":["Strong balance sheet"],"confidence":0.85}'
    )
    const agent = new FundamentalsAnalyst({ llm })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].fundamentalScore).toBe(78)
    expect(result.researchFindings[0].keyMetrics?.PE).toBe(25)
    expect(result.researchFindings[0].agentName).toBe('fundamentalsAnalyst')
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new FundamentalsAnalyst({ llm: mockLLM('bad') })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].confidence).toBe(0)
  })
})
