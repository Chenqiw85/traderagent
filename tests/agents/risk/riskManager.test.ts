// tests/agents/risk/riskManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { RiskManager } from '../../../src/agents/risk/RiskManager.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function reportWithRisk(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: [], confidence: 0.8 },
    ],
    riskAssessment: {
      riskLevel: 'medium',
      metrics: { VaR: 0.03, volatility: 0.22, beta: 1.1, maxDrawdown: 0.15 },
    },
  }
}

describe('RiskManager', () => {
  it('has correct name and role', () => {
    const agent = new RiskManager({ llm: mockLLM('{}') })
    expect(agent.name).toBe('riskManager')
    expect(agent.role).toBe('risk')
  })

  it('augments existing riskAssessment with position limits', async () => {
    const llm = mockLLM('{"maxPositionSize":0.05,"stopLoss":145.00,"takeProfit":165.00}')
    const agent = new RiskManager({ llm })
    const result = await agent.run(reportWithRisk())
    expect(result.riskAssessment?.maxPositionSize).toBe(0.05)
    expect(result.riskAssessment?.stopLoss).toBe(145.00)
    expect(result.riskAssessment?.takeProfit).toBe(165.00)
    // metrics from RiskAnalyst must be preserved
    expect(result.riskAssessment?.metrics.VaR).toBe(0.03)
  })

  it('returns report unchanged when no riskAssessment present', async () => {
    const llm = mockLLM('{"maxPositionSize":0.05}')
    const agent = new RiskManager({ llm })
    const report: TradingReport = {
      ticker: 'AAPL', market: 'US', timestamp: new Date(), rawData: [], researchFindings: [],
    }
    const result = await agent.run(report)
    expect(result.riskAssessment).toBeUndefined()
    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new RiskManager({ llm: mockLLM('not json') })
    const result = await agent.run(reportWithRisk())
    expect(result.riskAssessment?.riskLevel).toBe('medium')
    expect(result.riskAssessment?.maxPositionSize).toBeUndefined()
  })
})
