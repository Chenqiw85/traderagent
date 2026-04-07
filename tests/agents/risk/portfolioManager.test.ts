import { describe, expect, it, vi } from 'vitest'
import { PortfolioManager } from '../../../src/agents/risk/PortfolioManager.js'
import type { IAgent } from '../../../src/agents/base/IAgent.js'
import type { TradingReport } from '../../../src/agents/base/types.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function mockRiskAnalyst(report: TradingReport, analystName = 'riskAnalyst'): IAgent {
  return {
    name: analystName,
    role: 'risk',
    run: vi.fn().mockResolvedValue({
      ...report,
      analysisArtifacts: [
        ...(report.analysisArtifacts ?? []),
        ...(report.riskAssessment
          ? [{
              stage: 'risk' as const,
              agent: analystName,
              summary: `${analystName} assessment`,
              payload: {
                riskLevel: report.riskAssessment.riskLevel,
                maxPositionSize: report.riskAssessment.maxPositionSize,
                reasoning: `${analystName} reasoning`,
              },
            }]
          : []),
      ],
    }),
  }
}

function makeAssessmentReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-05T10:00:00Z'),
    rawData: [],
    researchFindings: [],
    analysisArtifacts: [],
    riskAssessment: {
      riskLevel: 'medium',
      metrics: { VaR: 0.03, volatility: 0.22, beta: 1.1, maxDrawdown: 0.15 },
      maxPositionSize: 0.04,
      stopLoss: 145,
      takeProfit: 165,
    },
  }
}

describe('PortfolioManager', () => {
  it('writes a rejecting verdict when no analysts produce a risk assessment', async () => {
    const emptyReport: TradingReport = {
      ticker: 'AAPL',
      market: 'US',
      timestamp: new Date('2026-04-05T10:00:00Z'),
      rawData: [],
      researchFindings: [],
      analysisArtifacts: [],
    }
    const llm = mockLLM('{"riskLevel":"low","maxPositionSize":0.1,"reasoning":"unused"}')
    const agent = new PortfolioManager({
      llm,
      riskAnalysts: [
        mockRiskAnalyst(emptyReport),
        mockRiskAnalyst(emptyReport),
        mockRiskAnalyst(emptyReport),
      ],
    })

    const result = await agent.run(emptyReport)

    expect(result.riskAssessment).toBeUndefined()
    expect(result.riskVerdict).toEqual({
      approved: false,
      summary: 'No risk assessments were produced by the analyst set.',
      blockers: ['Risk synthesis could not run because no analyst returned a risk assessment.'],
      requiredAdjustments: [],
    })
    expect(result.analysisArtifacts?.at(-1)).toEqual({
      stage: 'risk',
      agent: 'portfolioManager',
      summary: 'No risk assessments were produced by the analyst set.',
      payload: result.riskVerdict,
    })
    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('fails closed when synthesis output is malformed', async () => {
    const analystReport = makeAssessmentReport()
    const agent = new PortfolioManager({
      llm: mockLLM('not json'),
      riskAnalysts: [
        mockRiskAnalyst(analystReport, 'aggressive'),
        mockRiskAnalyst(analystReport, 'conservative'),
        mockRiskAnalyst(analystReport, 'neutral'),
      ],
    })

    const result = await agent.run(makeAssessmentReport())

    expect(result.riskAssessment?.riskLevel).toBe('high')
    expect(result.riskVerdict).toEqual({
      approved: false,
      summary: 'Defaulted due to synthesis failure',
      blockers: ['Risk synthesis failed; rejecting until a valid portfolio verdict is available.'],
      requiredAdjustments: [],
    })
    expect(result.analysisArtifacts?.at(-1)).toEqual({
      stage: 'risk',
      agent: 'portfolioManager',
      summary: 'Defaulted due to synthesis failure',
      payload: result.riskVerdict,
    })
  })

  it('fails closed when synthesis JSON has an invalid schema', async () => {
    const analystReport = makeAssessmentReport()
    const agent = new PortfolioManager({
      llm: mockLLM('{"riskLevel":"severe","maxPositionSize":"0.12","stopLoss":"145","takeProfit":165,"reasoning":42}'),
      riskAnalysts: [
        mockRiskAnalyst(analystReport, 'aggressive'),
        mockRiskAnalyst(analystReport, 'conservative'),
        mockRiskAnalyst(analystReport, 'neutral'),
      ],
    })

    const result = await agent.run(makeAssessmentReport())

    expect(result.riskAssessment?.riskLevel).toBe('high')
    expect(result.riskAssessment?.maxPositionSize).toBe(0.05)
    expect(result.riskAssessment?.stopLoss).toBeUndefined()
    expect(result.riskAssessment?.takeProfit).toBeUndefined()
    expect(result.riskVerdict).toEqual({
      approved: false,
      summary: 'Defaulted due to synthesis failure',
      blockers: ['Risk synthesis failed; rejecting until a valid portfolio verdict is available.'],
      requiredAdjustments: [],
    })
  })

  it('fails closed when synthesis numerics are out of domain', async () => {
    const analystReport = makeAssessmentReport()
    const agent = new PortfolioManager({
      llm: mockLLM('{"riskLevel":"low","maxPositionSize":1.2,"stopLoss":-145,"takeProfit":0,"reasoning":"invalid domain"}'),
      riskAnalysts: [
        mockRiskAnalyst(analystReport, 'aggressive'),
        mockRiskAnalyst(analystReport, 'conservative'),
        mockRiskAnalyst(analystReport, 'neutral'),
      ],
    })

    const result = await agent.run(makeAssessmentReport())

    expect(result.riskAssessment?.riskLevel).toBe('high')
    expect(result.riskVerdict?.approved).toBe(false)
    expect(result.riskVerdict?.summary).toBe('Defaulted due to synthesis failure')
  })

  it('uses the trader proposal and thesis when synthesizing the debate verdict', async () => {
    const analystReport = makeAssessmentReport()
    const llm = mockLLM(`{
      "approved": true,
      "riskLevel": "medium",
      "maxPositionSize": 0.08,
      "stopLoss": 148,
      "takeProfit": 172,
      "summary": "Approved with tighter sizing around the breakout.",
      "blockers": [],
      "requiredAdjustments": ["Keep size under 8% until follow-through confirms"],
      "reasoning": "The breakout setup is acceptable if size stays controlled."
    }`)
    const agent = new PortfolioManager({
      llm,
      riskAnalysts: [
        mockRiskAnalyst(analystReport, 'aggressive'),
        mockRiskAnalyst(analystReport, 'conservative'),
        mockRiskAnalyst(analystReport, 'neutral'),
      ],
    })

    const result = await agent.run({
      ...makeAssessmentReport(),
      researchFindings: [
        { agentName: 'bullResearcher', stance: 'bull', evidence: ['Momentum improving'], confidence: 0.72 },
        { agentName: 'bearResearcher', stance: 'bear', evidence: ['Valuation rich'], confidence: 0.41 },
      ],
      researchThesis: {
        stance: 'bull',
        confidence: 0.74,
        summary: 'Momentum and earnings revisions still support upside.',
        keyDrivers: ['Momentum', 'Earnings revisions'],
        keyRisks: ['Rich valuation'],
        invalidationConditions: ['Break back below prior breakout level'],
        timeHorizon: 'swing',
      },
      traderProposal: {
        action: 'BUY',
        confidence: 0.69,
        summary: 'Buy the breakout with defined invalidation.',
        entryLogic: 'Add above the prior day high.',
        whyNow: 'Trend, revisions, and volume expansion aligned today.',
        timeHorizon: 'swing',
        positionSizeFraction: 0.1,
        stopLoss: 148,
        takeProfit: 172,
        invalidationConditions: ['Close below the breakout level'],
      },
    })

    const systemPrompt = vi.mocked(llm.chat).mock.calls[0]?.[0]?.[0]?.content

    expect(systemPrompt).toContain('TRADER PROPOSAL')
    expect(systemPrompt).toContain('Add above the prior day high.')
    expect(systemPrompt).toContain('Trend, revisions, and volume expansion aligned today.')
    expect(systemPrompt).toContain('Research thesis: Momentum and earnings revisions still support upside.')
    expect(result.riskVerdict).toEqual({
      approved: true,
      summary: 'Approved with tighter sizing around the breakout.',
      blockers: [],
      requiredAdjustments: ['Keep size under 8% until follow-through confirms'],
    })
    expect(result.riskAssessment).toMatchObject({
      riskLevel: 'medium',
      maxPositionSize: 0.08,
      stopLoss: 148,
      takeProfit: 172,
    })
  })
})
