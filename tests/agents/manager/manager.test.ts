// tests/agents/manager/manager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Manager } from '../../../src/agents/manager/Manager.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function fullReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: ['Strong earnings'], confidence: 0.8 },
      { agentName: 'bearResearcher', stance: 'bear', evidence: ['High valuation'], confidence: 0.6 },
    ],
    riskAssessment: {
      riskLevel: 'medium',
      metrics: { VaR: 0.03, volatility: 0.22, beta: 1.1, maxDrawdown: 0.15 },
      maxPositionSize: 0.05,
      stopLoss: 145.00,
      takeProfit: 165.00,
    },
  }
}

describe('Manager', () => {
  it('has correct name and role', () => {
    const agent = new Manager({ llm: mockLLM('{}') })
    expect(agent.name).toBe('manager')
    expect(agent.role).toBe('manager')
  })

  it('sets finalDecision on the report', async () => {
    const llm = mockLLM(
      '{"action":"BUY","confidence":0.73,"reasoning":"Bull evidence outweighs bear evidence","suggestedPositionSize":0.04,"stopLoss":145.00,"takeProfit":165.00}'
    )
    const agent = new Manager({ llm })
    const result = await agent.run(fullReport())
    expect(result.finalDecision).toBeDefined()
    expect(result.finalDecision?.action).toBe('BUY')
    expect(result.finalDecision?.confidence).toBe(0.73)
    expect(result.finalDecision?.reasoning).toBe('Bull evidence outweighs bear evidence')
  })

  it('falls back to HOLD with confidence 0 on malformed response', async () => {
    const agent = new Manager({ llm: mockLLM('not json') })
    const result = await agent.run(fullReport())
    expect(result.finalDecision?.action).toBe('HOLD')
    expect(result.finalDecision?.confidence).toBe(0)
  })

  it('includes all agent names in LLM context', async () => {
    const llm = mockLLM('{"action":"SELL","confidence":0.65,"reasoning":"Risk too high"}')
    const agent = new Manager({ llm })
    await agent.run(fullReport())
    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(messages[0].content).toContain('bullResearcher')
    expect(messages[0].content).toContain('bearResearcher')
    expect(messages[0].content).toContain('medium')
  })
})
