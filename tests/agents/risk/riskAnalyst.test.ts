import { describe, it, expect, vi } from 'vitest'
import { RiskAnalyst } from '../../../src/agents/risk/RiskAnalyst.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function reportWithData(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [{ ticker: 'AAPL', market: 'US', type: 'ohlcv', data: [{ close: 150 }], fetchedAt: new Date() }],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: ['Strong earnings'], confidence: 0.8 },
    ],
  }
}

describe('RiskAnalyst', () => {
  it('has correct name and role', () => {
    const agent = new RiskAnalyst({ llm: mockLLM('{}') })
    expect(agent.name).toBe('riskAnalyst')
    expect(agent.role).toBe('risk')
  })

  it('sets riskAssessment with metrics on the report', async () => {
    const llm = mockLLM(
      '{"riskLevel":"medium","metrics":{"VaR":0.03,"volatility":0.22,"beta":1.1,"maxDrawdown":0.15}}'
    )
    const agent = new RiskAnalyst({ llm })
    const result = await agent.run(reportWithData())
    expect(result.riskAssessment).toBeDefined()
    expect(result.riskAssessment?.riskLevel).toBe('medium')
    expect(result.riskAssessment?.metrics.VaR).toBe(0.03)
    expect(result.riskAssessment?.metrics.volatility).toBe(0.22)
  })

  it('calls LLM with ticker in context', async () => {
    const llm = mockLLM(
      '{"riskLevel":"low","metrics":{"VaR":0.01,"volatility":0.1,"beta":0.8,"maxDrawdown":0.05}}'
    )
    const agent = new RiskAnalyst({ llm })
    await agent.run(reportWithData())
    expect(llm.chat).toHaveBeenCalledOnce()
    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(messages[0].content).toContain('AAPL')
  })

  it('falls back to default values on malformed LLM response', async () => {
    const agent = new RiskAnalyst({ llm: mockLLM('not json') })
    const result = await agent.run(reportWithData())
    expect(result.riskAssessment?.riskLevel).toBe('medium')
    expect(result.riskAssessment?.metrics.VaR).toBe(0)
  })
})
