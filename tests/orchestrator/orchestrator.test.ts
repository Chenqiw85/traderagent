import { describe, it, expect, vi } from 'vitest'
import { Orchestrator } from '../../src/orchestrator/Orchestrator.js'
import type { IAgent } from '../../src/agents/base/IAgent.js'
import type { AgentRole, TradingReport } from '../../src/agents/base/types.js'
import type { DataQualityAssessor } from '../../src/agents/data/DataQualityAssessor.js'
import type { ProposalValidator } from '../../src/agents/trader/ProposalValidator.js'

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

  it('runs the live quote overlay after data fetch and before technical analysis', async () => {
    const callOrder: string[] = []
    const liveSnapshot = {
      source: 'test-live-source',
      fetchedAt: new Date('2026-04-08T20:01:00.000Z'),
      regularMarketPrice: 151.25,
    }

    const dataFetcher = mockAgent('dataFetcher', 'data', (r) => {
      callOrder.push('dataFetcher')
      return r
    })
    const realtimeQuoteFetcher = mockAgent('realtimeQuoteFetcher', 'data', (r) => {
      callOrder.push('realtimeQuoteFetcher')
      return {
        ...r,
        liveMarketSnapshot: liveSnapshot,
      }
    })
    const technicalAnalyzer = mockAgent('technicalAnalyzer', 'data', (r) => {
      callOrder.push('technicalAnalyzer')
      expect(r.liveMarketSnapshot).toEqual(liveSnapshot)
      return r
    })
    const tradePlanner = mockAgent('tradePlanner', 'trader', (r) => {
      callOrder.push('tradePlanner')
      expect(r.liveMarketSnapshot).toEqual(liveSnapshot)
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
      expect(r.liveMarketSnapshot).toEqual(liveSnapshot)
      return { ...r, finalDecision: { action: 'BUY' as const, confidence: 0.7, reasoning: 'test' } }
    })

    const orchestrator = new Orchestrator({
      dataFetcher,
      realtimeQuoteFetcher,
      technicalAnalyzer,
      researcherTeam: [],
      tradePlanner,
      riskTeam: [riskAnalyst, riskManager],
      manager,
    })

    const result = await orchestrator.run('AAPL', 'US')

    expect(callOrder).toEqual([
      'dataFetcher',
      'realtimeQuoteFetcher',
      'technicalAnalyzer',
      'tradePlanner',
      'riskAnalyst',
      'riskManager',
      'manager',
    ])
    expect(result.liveMarketSnapshot).toEqual(liveSnapshot)
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

  it('preserves researcher lesson retrievals in the final report in parallel mode', async () => {
    const bull = mockAgent('bull', 'researcher', (r) => ({
      ...r,
      researchFindings: [...r.researchFindings, { agentName: 'bull', stance: 'bull' as const, evidence: [], confidence: 0.8 }],
      lessonRetrievals: [
        ...(r.lessonRetrievals ?? []),
        {
          lessonId: 'lesson-bull-1',
          agent: 'bull',
          perspective: 'shared' as const,
          source: 'extractor' as const,
          ticker: r.ticker,
          market: r.market,
          asOf: r.timestamp,
          query: 'bull query',
          rank: 1,
        },
      ],
    }))
    const bear = mockAgent('bear', 'researcher', (r) => ({
      ...r,
      researchFindings: [...r.researchFindings, { agentName: 'bear', stance: 'bear' as const, evidence: [], confidence: 0.6 }],
      lessonRetrievals: [
        ...(r.lessonRetrievals ?? []),
        {
          lessonId: 'lesson-bear-1',
          agent: 'bear',
          perspective: 'shared' as const,
          source: 'reflection' as const,
          ticker: r.ticker,
          market: r.market,
          asOf: r.timestamp,
          query: 'bear query',
          rank: 1,
        },
      ],
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

    expect(result.lessonRetrievals).toEqual([
      expect.objectContaining({ lessonId: 'lesson-bull-1', source: 'extractor' }),
      expect.objectContaining({ lessonId: 'lesson-bear-1', source: 'reflection' }),
    ])
  })

  it('preserves researcher lesson retrievals in the final report in debate mode', async () => {
    const bull = mockAgent('bull', 'researcher', (r) => ({
      ...r,
      researchFindings: [...r.researchFindings, { agentName: 'bull', stance: 'bull' as const, evidence: ['bull case'], confidence: 0.8 }],
      lessonRetrievals: [
        ...(r.lessonRetrievals ?? []),
        {
          lessonId: 'lesson-bull-debate',
          agent: 'bull',
          perspective: 'shared' as const,
          source: 'extractor' as const,
          ticker: r.ticker,
          market: r.market,
          asOf: r.timestamp,
          query: 'bull debate query',
          rank: 1,
        },
      ],
    }))
    const bear = mockAgent('bear', 'researcher', (r) => ({
      ...r,
      researchFindings: [...r.researchFindings, { agentName: 'bear', stance: 'bear' as const, evidence: ['bear case'], confidence: 0.6 }],
      lessonRetrievals: [
        ...(r.lessonRetrievals ?? []),
        {
          lessonId: 'lesson-bear-debate',
          agent: 'bear',
          perspective: 'shared' as const,
          source: 'reflection' as const,
          ticker: r.ticker,
          market: r.market,
          asOf: r.timestamp,
          query: 'bear debate query',
          rank: 1,
        },
      ],
    }))
    const debateEngine = {
      debate: vi.fn().mockResolvedValue({
        rounds: [],
        bullFinal: { agentName: 'bullResearcher_r1', stance: 'bull' as const, evidence: ['debated bull'], confidence: 0.82 },
        bearFinal: { agentName: 'bearResearcher_r1', stance: 'bear' as const, evidence: ['debated bear'], confidence: 0.58 },
      }),
    }
    const researchManager = {
      name: 'researchManager',
      role: 'researcher' as const,
      run: vi.fn().mockImplementation(async (r: TradingReport) => ({
        ...r,
        researchFindings: [
          ...r.researchFindings,
          { agentName: 'researchManager', stance: 'neutral' as const, evidence: ['balanced'], confidence: 0.5 },
        ],
      })),
    }
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
      bullResearcher: bull,
      bearResearcher: bear,
      debateEngine: debateEngine as never,
      researchManager: researchManager as never,
    })

    const result = await orchestrator.run('TSLA', 'US')

    expect(result.lessonRetrievals).toEqual([
      expect.objectContaining({ lessonId: 'lesson-bull-debate', source: 'extractor' }),
      expect.objectContaining({ lessonId: 'lesson-bear-debate', source: 'reflection' }),
    ])
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

  it('runs DataQualityAssessor after DataFetcher and attaches dataQuality to report', async () => {
    const callOrder: string[] = []

    const dataFetcher = mockAgent('dataFetcher', 'data', (r) => {
      callOrder.push('dataFetcher')
      return r
    })

    const mockDataQualityAssessor = {
      name: 'dataQualityAssessor',
      role: 'data' as AgentRole,
      run: vi.fn().mockImplementation(async (r: TradingReport) => {
        callOrder.push('dataQualityAssessor')
        return {
          ...r,
          dataQuality: {
            fundamentals: { available: [], missing: [], completeness: 0 },
            news: { available: [], missing: [], completeness: 0 },
            technicals: { available: [], missing: [], completeness: 0 },
            ohlcv: { available: [], missing: [], completeness: 0 },
            overall: 0,
            advisory: 'No data available.',
          },
        }
      }),
    } as unknown as DataQualityAssessor

    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: { action: 'HOLD' as const, confidence: 0.5, reasoning: 'test' },
    }))

    const orchestrator = new Orchestrator({
      dataFetcher,
      researcherTeam: [],
      riskTeam: [],
      manager,
      dataQualityAssessor: mockDataQualityAssessor,
    })

    const result = await orchestrator.run('AAPL', 'US')

    expect(callOrder[0]).toBe('dataFetcher')
    // dataQualityAssessor runs after technical indicators (stage 3b), not immediately after data fetch
    expect(callOrder).toContain('dataQualityAssessor')
    expect(result.dataQuality).toBeDefined()
    expect(result.dataQuality?.advisory).toBe('No data available.')
  })

  it('runs ProposalValidator after TradePlanner and attaches proposalValidation to report', async () => {
    const researchThesis = {
      stance: 'bull' as const,
      confidence: 0.8,
      summary: 'Strong bull thesis',
      keyDrivers: ['momentum'],
      keyRisks: ['recession'],
      invalidationConditions: ['breaks support'],
      timeHorizon: 'short' as const,
    }

    // ResearchManager sets the thesis on the report
    const researchManager = {
      name: 'researchManager',
      role: 'researcher' as AgentRole,
      run: vi.fn().mockImplementation(async (r: TradingReport) => ({
        ...r,
        researchThesis,
      })),
    }

    const tradePlanner = mockAgent('tradePlanner', 'trader', (r) => ({
      ...r,
      traderProposal: {
        action: 'BUY' as const,
        confidence: 0.75,
        summary: 'buy the dip',
        entryLogic: 'at support',
        whyNow: 'trend up',
        timeHorizon: 'short' as const,
        invalidationConditions: ['breaks support'],
      },
    }))

    const mockProposalValidator = {
      validate: vi.fn().mockReturnValue({
        valid: true,
        directionAligned: true,
        rrRatioValid: true,
        priceSane: true,
        confidenceConsistent: true,
        computedRR: null,
        violations: [],
      }),
    } as unknown as ProposalValidator

    const riskAnalyst = mockAgent('riskAnalyst', 'risk', (r) => ({
      ...r,
      riskAssessment: {
        riskLevel: 'low' as const,
        metrics: { VaR: 0.01, volatility: 0.1, beta: 0.9, maxDrawdown: 0.05 },
      },
    }))

    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: { action: 'BUY' as const, confidence: 0.75, reasoning: 'aligned' },
    }))

    const orchestrator = new Orchestrator({
      researcherTeam: [],
      researchManager: researchManager as never,
      tradePlanner,
      riskTeam: [riskAnalyst],
      manager,
      proposalValidator: mockProposalValidator,
    })

    const result = await orchestrator.run('AAPL', 'US')

    expect(mockProposalValidator.validate).toHaveBeenCalledOnce()
    expect(result.proposalValidation).toBeDefined()
    expect(result.proposalValidation?.valid).toBe(true)
    expect(result.proposalValidation?.directionAligned).toBe(true)
  })

  it('runs researchManager after evidence validation and conflict resolution', async () => {
    const bull = mockAgent('bull', 'researcher', (r) => ({
      ...r,
      researchFindings: [
        ...r.researchFindings,
        { agentName: 'bull', stance: 'bull' as const, evidence: ['Demand is improving'], confidence: 0.8 },
      ],
    }))
    const bear = mockAgent('bear', 'researcher', (r) => ({
      ...r,
      researchFindings: [
        ...r.researchFindings,
        { agentName: 'bear', stance: 'bear' as const, evidence: ['Margins are contracting'], confidence: 0.6 },
      ],
    }))
    const evidenceValidator = {
      validate: vi.fn()
        .mockResolvedValueOnce({
          agentName: 'bull',
          valid: true,
          violations: [],
          groundedEvidence: ['Demand is improving'],
          ungroundedClaims: [],
        })
        .mockResolvedValueOnce({
          agentName: 'bear',
          valid: true,
          violations: [],
          groundedEvidence: ['Margins are contracting'],
          ungroundedClaims: [],
        }),
    }
    const conflictDetector = {
      findMetricOverlaps: vi.fn().mockReturnValue(['overlap']),
      checkContradictions: vi.fn().mockResolvedValue([
        {
          metric: 'margin',
          bullClaim: 'Demand is improving',
          bearClaim: 'Margins are contracting',
          isContradiction: true,
          severity: 'high' as const,
        },
      ]),
    }
    const conflictResolver = {
      resolveAll: vi.fn().mockResolvedValue([
        {
          conflict: {
            metric: 'margin',
            bullClaim: 'Demand is improving',
            bearClaim: 'Margins are contracting',
            isContradiction: true,
            severity: 'high' as const,
          },
          winner: 'bull' as const,
          reasoning: 'Demand trend is better grounded.',
          adjustedConfidence: { bull: 0.8, bear: 0.3 },
        },
      ]),
    }
    const technicalAnalyzer = mockAgent('technicalAnalyzer', 'data', (r) => ({
      ...r,
      computedIndicators: {
        trend: {
          sma50: 105,
          sma200: 100,
          ema12: 106,
          ema26: 103,
          macd: { line: 1.2, signal: 0.8, histogram: 0.4 },
        },
        momentum: {
          rsi: 58,
          stochastic: { k: 62, d: 57 },
        },
        volatility: {
          bollingerUpper: 110,
          bollingerMiddle: 104,
          bollingerLower: 98,
          atr: 2.4,
          historicalVolatility: 0.22,
        },
        volume: { obv: 1500 },
        risk: { beta: 1.1, maxDrawdown: 0.12, var95: 0.03 },
        fundamentals: { pe: 24, pb: 4.5, dividendYield: 0.01, eps: 5.1 },
      },
    }))
    const researchManager = {
      name: 'researchManager',
      role: 'researcher' as AgentRole,
      run: vi.fn().mockImplementation(async (r: TradingReport) => {
        expect(r.researchFindings.map((finding) => finding.agentName)).toEqual(['bull', 'bear'])
        expect(r.conflictResolutions).toHaveLength(1)
        return {
          ...r,
          researchThesis: {
            stance: 'bull' as const,
            confidence: 0.75,
            summary: 'Bull thesis uses validated findings and resolved conflicts.',
            keyDrivers: ['Demand is improving'],
            keyRisks: ['Margins are contracting'],
            invalidationConditions: ['Demand weakens'],
            timeHorizon: 'swing' as const,
          },
        }
      }),
    }
    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: { action: 'HOLD' as const, confidence: 0.5, reasoning: 'test' },
    }))

    const orchestrator = new Orchestrator({
      researcherTeam: [bull, bear],
      riskTeam: [],
      manager,
      technicalAnalyzer,
      researchManager: researchManager as never,
      evidenceValidator: evidenceValidator as never,
      conflictDetector: conflictDetector as never,
      conflictResolver: conflictResolver as never,
    })

    const result = await orchestrator.run('AAPL', 'US')

    expect(researchManager.run).toHaveBeenCalledTimes(1)
    expect(result.researchThesis?.summary).toContain('validated findings')
  })

  it('keeps only validated findings when one side fails grounding', async () => {
    const bullFinding = {
      agentName: 'bullResearcher',
      stance: 'bull' as const,
      evidence: ['Demand is improving'],
      confidence: 0.8,
    }
    const bearFinding = {
      agentName: 'bearResearcher',
      stance: 'bear' as const,
      evidence: ['Margins are collapsing'],
      confidence: 0.6,
    }

    const bull = mockAgent('bull', 'researcher', (r) => ({
      ...r,
      researchFindings: [...r.researchFindings, bullFinding],
    }))
    const bear = mockAgent('bear', 'researcher', (r) => ({
      ...r,
      researchFindings: [...r.researchFindings, bearFinding],
    }))
    const evidenceValidator = {
      validate: vi.fn()
        .mockResolvedValueOnce({
          agentName: 'bullResearcher',
          valid: true,
          violations: [],
          groundedEvidence: ['Demand is improving'],
          ungroundedClaims: [],
        })
        .mockResolvedValueOnce({
          agentName: 'bearResearcher',
          valid: false,
          violations: ['Claim is unsupported'],
          groundedEvidence: [],
          ungroundedClaims: ['Margins are collapsing'],
        }),
    }
    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: { action: 'HOLD' as const, confidence: 0.5, reasoning: 'validated bull only' },
    }))

    const orchestrator = new Orchestrator({
      researcherTeam: [bull, bear],
      riskTeam: [],
      manager,
      evidenceValidator: evidenceValidator as never,
    })

    const result = await orchestrator.run('AAPL', 'US')

    expect(evidenceValidator.validate).toHaveBeenCalledTimes(2)
    expect(result.evidenceValidations).toHaveLength(2)
    expect(result.researchFindings).toEqual([bullFinding])
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
