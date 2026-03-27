import { describe, it, expect, vi } from 'vitest'
import { BearResearcher } from '../../../src/agents/researcher/BearResearcher.js'
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
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [
      { type: 'ohlcv', ticker: 'AAPL', market: 'US', data: {}, fetchedAt: new Date() },
      { type: 'fundamentals', ticker: 'AAPL', market: 'US', data: {}, fetchedAt: new Date() },
    ],
    researchFindings: [],
  }
}

describe('BearResearcher', () => {
  it('has correct name and role', () => {
    const agent = new BearResearcher({ llm: mockLLM('{}') })
    expect(agent.name).toBe('bearResearcher')
    expect(agent.role).toBe('researcher')
  })

  it('appends a bear finding to researchFindings', async () => {
    const llm = mockLLM('{"stance":"bear","evidence":["Declining revenue"],"confidence":0.75}')
    const agent = new BearResearcher({ llm })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings).toHaveLength(1)
    expect(result.researchFindings[0].stance).toBe('bear')
    expect(result.researchFindings[0].agentName).toBe('bearResearcher')
    expect(result.researchFindings[0].confidence).toBe(0.75)
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new BearResearcher({ llm: mockLLM('not json') })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].stance).toBe('neutral')
    expect(result.researchFindings[0].confidence).toBe(0)
  })
})
