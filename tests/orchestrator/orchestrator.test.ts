import { describe, it, expect, vi } from 'vitest'
import { Orchestrator } from '../../src/orchestrator/Orchestrator.js'
import type { IAgent } from '../../src/agents/base/IAgent.js'
import type { AgentRole, TradingReport } from '../../src/agents/base/types.js'

function mockAgent(
  name: string,
  role: AgentRole,
  transform: (r: TradingReport) => TradingReport
): IAgent {
  return {
    name,
    role,
    run: vi.fn().mockImplementation((r: TradingReport) => Promise.resolve(transform(r))),
  }
}

describe('Orchestrator', () => {
  it('runs dataFetcher first and manager last', async () => {
    const callOrder: string[] = []

    const dataFetcher = mockAgent('dataFetcher', 'data', (r) => {
      callOrder.push('dataFetcher')
      return r
    })
    const bull = mockAgent('bull', 'researcher', (r) => {
      callOrder.push('bull')
      return { ...r, researchFindings: [...r.researchFindings, { agentName: 'bull', stance: 'bull' as const, evidence: [], confidence: 0.8 }] }
    })
    const tradePlanner = mockAgent('tradePlanner', 'trader', (r) => {
      callOrder.push('tradePlanner')
      return {
        ...r,
        traderProposal: {
          action: 'BUY' as const,
          confidence: 0.7,
          summary: 'test proposal',
          entryLogic: 'buy pullback',
          whyNow: 'trend aligned',
          timeHorizon: 'short' as const,
          invalidationConditions: [],
        },
      }
    })
    const riskAnalyst = mockAgent('riskAnalyst', 'risk', (r) => {
      callOrder.push('riskAnalyst')
      return { ...r, riskAssessment: { riskLevel: 'medium' as const, metrics: { VaR: 0.03, volatility: 0.22, beta: 1.1, maxDrawdown: 0.15 } } }
    })
    const riskManager = mockAgent('riskManager', 'risk', (r) => {
      callOrder.push('riskManager')
      return r
    })
    const manager = mockAgent('manager', 'manager', (r) => {
      callOrder.push('manager')
      return { ...r, finalDecision: { action: 'BUY' as const, confidence: 0.7, reasoning: 'test' } }
    })

    const orchestrator = new Orchestrator({
      dataFetcher,
      researcherTeam: [bull],
      tradePlanner,
      riskTeam: [riskAnalyst, riskManager],
      manager,
    })

    const result = await orchestrator.run('AAPL', 'US')

    expect(callOrder[0]).toBe('dataFetcher')
    expect(callOrder[callOrder.length - 1]).toBe('manager')
    expect(callOrder.indexOf('bull')).toBeLessThan(callOrder.indexOf('tradePlanner'))
    expect(callOrder.indexOf('tradePlanner')).toBeLessThan(callOrder.indexOf('riskAnalyst'))
    expect(callOrder.indexOf('riskAnalyst')).toBeLessThan(callOrder.indexOf('riskManager'))
    expect(result.traderProposal?.action).toBe('BUY')
    expect(result.finalDecision?.action).toBe('BUY')
  })

  it('merges all researcher findings into the report', async () => {
    const bull = mockAgent('bull', 'researcher', (r) => ({
      ...r,
      researchFindings: [...r.researchFindings, { agentName: 'bull', stance: 'bull' as const, evidence: [], confidence: 0.8 }],
    }))
    const bear = mockAgent('bear', 'researcher', (r) => ({
      ...r,
      researchFindings: [...r.researchFindings, { agentName: 'bear', stance: 'bear' as const, evidence: [], confidence: 0.6 }],
    }))
    const riskAnalyst = mockAgent('riskAnalyst', 'risk', (r) => ({
      ...r,
      riskAssessment: { riskLevel: 'low' as const, metrics: { VaR: 0.01, volatility: 0.1, beta: 0.9, maxDrawdown: 0.05 } },
    }))
    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: { action: 'HOLD' as const, confidence: 0.5, reasoning: 'neutral' },
    }))

    const orchestrator = new Orchestrator({
      researcherTeam: [bull, bear],
      riskTeam: [riskAnalyst],
      manager,
    })

    const result = await orchestrator.run('TSLA', 'US')
    expect(result.researchFindings).toHaveLength(2)
    expect(result.researchFindings.map((f) => f.agentName)).toContain('bull')
    expect(result.researchFindings.map((f) => f.agentName)).toContain('bear')
  })

  it('works without a dataFetcher', async () => {
    const riskAnalyst = mockAgent('riskAnalyst', 'risk', (r) => ({
      ...r,
      riskAssessment: { riskLevel: 'low' as const, metrics: { VaR: 0.01, volatility: 0.1, beta: 0.9, maxDrawdown: 0.05 } },
    }))
    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: { action: 'HOLD' as const, confidence: 0.5, reasoning: 'no data' },
    }))
    const orchestrator = new Orchestrator({ researcherTeam: [], riskTeam: [riskAnalyst], manager })
    const result = await orchestrator.run('AAPL', 'US')
    expect(result.finalDecision).toBeDefined()
    expect(result.ticker).toBe('AAPL')
    expect(result.market).toBe('US')
  })

  it('publishes the latest completed report so callers can persist partial state on failure', async () => {
    const snapshots: TradingReport[] = []

    const researcher = mockAgent('bull', 'researcher', (r) => ({
      ...r,
      researchFindings: [
        ...r.researchFindings,
        { agentName: 'bull', stance: 'bull' as const, evidence: ['momentum'], confidence: 0.7 },
      ],
    }))
    const tradePlanner = mockAgent('tradePlanner', 'trader', (r) => ({
      ...r,
      traderProposal: {
        action: 'BUY' as const,
        confidence: 0.66,
        summary: 'Buy the breakout.',
        entryLogic: 'Add above prior day high.',
        whyNow: 'Trend is aligned.',
        timeHorizon: 'swing' as const,
        invalidationConditions: ['Close below breakout'],
      },
    }))
    const explodingRisk = {
      name: 'riskAnalyst',
      role: 'risk' as const,
      run: vi.fn().mockRejectedValue(new Error('risk stage failed')),
    }
    const manager = mockAgent('manager', 'manager', (r) => r)

    const orchestrator = new Orchestrator({
      researcherTeam: [researcher],
      tradePlanner,
      riskTeam: [explodingRisk],
      manager,
    })

    await expect(
      orchestrator.run('AAPL', 'US', {
        onReportUpdate: (report) => {
          snapshots.push(structuredClone(report))
        },
      }),
    ).rejects.toThrow('risk stage failed')

    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(snapshots.at(-1)?.traderProposal).toMatchObject({
      action: 'BUY',
      summary: 'Buy the breakout.',
    })
  })
})
