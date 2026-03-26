import { describe, it, expect, vi } from 'vitest'
import { NewsAnalyst } from '../../../src/agents/researcher/NewsAnalyst.js'
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

describe('NewsAnalyst', () => {
  it('has correct name and role', () => {
    const agent = new NewsAnalyst({ llm: mockLLM('{}') })
    expect(agent.name).toBe('newsAnalyst')
    expect(agent.role).toBe('researcher')
  })

  it('captures sentiment in the finding', async () => {
    const llm = mockLLM(
      '{"stance":"bull","sentiment":"broadly positive coverage","evidence":["CEO praised"],"confidence":0.6}'
    )
    const agent = new NewsAnalyst({ llm })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].sentiment).toBe('broadly positive coverage')
    expect(result.researchFindings[0].agentName).toBe('newsAnalyst')
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new NewsAnalyst({ llm: mockLLM('bad') })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].confidence).toBe(0)
  })
})
