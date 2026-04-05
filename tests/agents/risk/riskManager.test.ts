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
    traderProposal: {
      action: 'BUY',
      confidence: 0.74,
      summary: 'Enter on continued trend strength with a tight stop below support.',
      entryLogic: 'Buy a breakout above 182 with confirmation volume.',
      whyNow: 'Momentum and revisions are aligned.',
      timeHorizon: 'swing',
      positionSizeFraction: 0.06,
      stopLoss: 176,
      takeProfit: 196,
      invalidationConditions: ['Daily close back below 50DMA'],
    },
    riskAssessment: {
      riskLevel: 'medium',
      metrics: { VaR: 0.03, volatility: 0.22, beta: 1.1, maxDrawdown: 0.15 },
    },
    analysisArtifacts: [],
  }
}

describe('RiskManager', () => {
  it('has correct name and role', () => {
    const agent = new RiskManager({ llm: mockLLM('{}') })
    expect(agent.name).toBe('riskManager')
    expect(agent.role).toBe('risk')
  })

  it('writes riskVerdict, appends an artifact, and preserves riskAssessment metrics', async () => {
    const llm = mockLLM(
      '{"approved":true,"summary":"Proposal is acceptable with a smaller size.","blockers":[],"requiredAdjustments":["Scale down position size"],"maxPositionSize":0.05,"stopLoss":145.00,"takeProfit":165.00}'
    )
    const agent = new RiskManager({ llm })
    const result = await agent.run(reportWithRisk())

    expect(result.riskVerdict).toEqual({
      approved: true,
      summary: 'Proposal is acceptable with a smaller size.',
      blockers: [],
      requiredAdjustments: ['Scale down position size'],
    })
    expect(result.riskAssessment?.maxPositionSize).toBe(0.05)
    expect(result.riskAssessment?.stopLoss).toBe(145.00)
    expect(result.riskAssessment?.takeProfit).toBe(165.00)
    expect(result.riskAssessment?.metrics.VaR).toBe(0.03)
    expect(result.analysisArtifacts?.at(-1)).toEqual({
      stage: 'risk',
      agent: 'riskManager',
      summary: 'Proposal is acceptable with a smaller size.',
      payload: result.riskVerdict,
    })
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

  it('returns report unchanged when traderProposal is missing', async () => {
    const llm = mockLLM('{"approved":true,"summary":"ok","blockers":[],"requiredAdjustments":[]}')
    const agent = new RiskManager({ llm })
    const report = reportWithRisk()
    delete report.traderProposal

    const result = await agent.run(report)

    expect(result).toEqual(report)
    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new RiskManager({ llm: mockLLM('not json') })
    const result = await agent.run(reportWithRisk())
    expect(result.riskAssessment?.riskLevel).toBe('medium')
    expect(result.riskAssessment?.maxPositionSize).toBeUndefined()
    expect(result.riskVerdict).toEqual({
      approved: false,
      summary: 'Unable to parse risk review response',
      blockers: ['Risk review response was invalid'],
      requiredAdjustments: [],
    })
  })

  it('drops out-of-range numeric risk limits while keeping the verdict', async () => {
    const agent = new RiskManager({
      llm: mockLLM(
        '{"approved":true,"summary":"Proposal is acceptable.","blockers":[],"requiredAdjustments":[],"maxPositionSize":1.3,"stopLoss":-145,"takeProfit":0}'
      ),
    })

    const result = await agent.run(reportWithRisk())

    expect(result.riskVerdict).toEqual({
      approved: true,
      summary: 'Proposal is acceptable.',
      blockers: [],
      requiredAdjustments: [],
    })
    expect(result.riskAssessment?.maxPositionSize).toBeUndefined()
    expect(result.riskAssessment?.stopLoss).toBeUndefined()
    expect(result.riskAssessment?.takeProfit).toBeUndefined()
  })
})
