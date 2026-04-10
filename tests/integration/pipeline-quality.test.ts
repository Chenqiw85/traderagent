import { describe, it, expect, vi } from 'vitest'
import { Orchestrator } from '../../src/orchestrator/Orchestrator.js'
import { DataQualityAssessor } from '../../src/agents/data/DataQualityAssessor.js'
import { FundamentalsScorer } from '../../src/agents/researcher/FundamentalsScorer.js'
import { EvidenceValidator } from '../../src/agents/researcher/EvidenceValidator.js'
import { ConflictDetector } from '../../src/agents/researcher/ConflictDetector.js'
import { ConflictResolver } from '../../src/agents/researcher/ConflictResolver.js'
import { ProposalValidator } from '../../src/agents/trader/ProposalValidator.js'
import type { TradingReport, AgentRole, DataResult } from '../../src/agents/base/types.js'
import type { IAgent } from '../../src/agents/base/IAgent.js'
import type { ILLMProvider } from '../../src/llm/ILLMProvider.js'

function mockLLM(responses: Record<string, string>): ILLMProvider {
  let callCount = 0
  const keys = Object.keys(responses)
  return {
    name: 'mock',
    chat: vi.fn().mockImplementation(async () => {
      const response = keys.length > 0 ? responses[keys[callCount % keys.length]]! : '{}'
      callCount++
      return response
    }),
    chatStream: vi.fn(),
  }
}

function mockAgent(name: string, role: AgentRole, transform: (r: TradingReport) => TradingReport): IAgent {
  return {
    name,
    role,
    run: vi.fn().mockImplementation(async (r: TradingReport) => transform(r)),
  }
}

describe('Pipeline Quality Integration', () => {
  it('completes full pipeline with all validators passing', async () => {
    const llm = mockLLM({
      advisory: 'All data available.',
      evidence: JSON.stringify({ valid: true, groundedEvidence: ['RSI at 55'], ungroundedClaims: [], violations: [] }),
      conflict: JSON.stringify({ isContradiction: false, severity: 'low' }),
    })

    const dataFetcher = mockAgent('dataFetcher', 'data', (r) => ({
      ...r,
      rawData: [
        {
          ticker: 'AAPL',
          market: 'US',
          type: 'ohlcv',
          data: [{ date: '2026-04-07', open: 100, high: 105, low: 99, close: 103, volume: 1000000 }],
          fetchedAt: new Date(),
        },
        {
          ticker: 'AAPL',
          market: 'US',
          type: 'fundamentals',
          data: { pe: 25, pb: 3.5, roe: 0.2, debtToEquity: 0.5, revenueGrowth: 0.12, epsGrowth: 0.1, margins: 0.22, currentRatio: 1.5, interestCoverage: 8, evToEbitda: 18, dividendYield: 0.015, eps: 6.5 },
          fetchedAt: new Date(),
        },
        {
          ticker: 'AAPL',
          market: 'US',
          type: 'technicals',
          data: { rsi: 55, macd: { line: 1, signal: 0.5, histogram: 0.5 } },
          fetchedAt: new Date(),
        },
      ] as DataResult[],
    }))

    const technicalAnalyzer = mockAgent('technicalAnalyzer', 'data', (r) => ({
      ...r,
      computedIndicators: {
        trend: { sma50: 170, sma200: 160, ema12: 175, ema26: 170, macd: { line: 5, signal: 3, histogram: 2 } },
        momentum: { rsi: 55, stochastic: { k: 60, d: 55 } },
        volatility: { bollingerUpper: 185, bollingerMiddle: 175, bollingerLower: 165, atr: 3.5, historicalVolatility: 0.25 },
        volume: { obv: 1000000 },
        risk: { beta: 1.1, maxDrawdown: 0.12, var95: 0.02 },
        fundamentals: { pe: 25, pb: 3.5, dividendYield: 0.015, eps: 6.5 },
      },
    }))

    const bullResearcher = mockAgent('bullResearcher', 'researcher', (r) => ({
      ...r,
      researchFindings: [
        ...r.researchFindings,
        {
          agentName: 'bullResearcher',
          stance: 'bull' as const,
          evidence: ['RSI at 55 shows healthy momentum'],
          confidence: 0.7,
        },
      ],
    }))

    const bearResearcher = mockAgent('bearResearcher', 'researcher', (r) => ({
      ...r,
      researchFindings: [
        ...r.researchFindings,
        {
          agentName: 'bearResearcher',
          stance: 'bear' as const,
          evidence: ['Max drawdown of 12% is moderate risk'],
          confidence: 0.5,
        },
      ],
    }))

    const tradePlanner = mockAgent('tradePlanner', 'trader', (r) => ({
      ...r,
      traderProposal: {
        action: 'BUY' as const,
        confidence: 0.65,
        summary: 'Buy breakout',
        entryLogic: 'Break above 180',
        whyNow: 'MACD crossover',
        timeHorizon: 'swing' as const,
        referencePrice: 175,
        stopLoss: 165,
        takeProfit: 195,
        invalidationConditions: ['breaks below 160'],
      },
      researchThesis: {
        stance: 'bull' as const,
        confidence: 0.7,
        summary: 'Bullish',
        keyDrivers: ['momentum'],
        keyRisks: ['volatility'],
        invalidationConditions: ['breaks below SMA200'],
        timeHorizon: 'swing' as const,
      },
    }))

    const riskAnalyst = mockAgent('riskAnalyst', 'risk', (r) => ({
      ...r,
      riskAssessment: {
        riskLevel: 'medium' as const,
        metrics: { VaR: 0.025, volatility: 0.25, beta: 1.1, maxDrawdown: 0.12 },
      },
    }))

    const riskManager = mockAgent('riskManager', 'risk', (r) => ({
      ...r,
      riskVerdict: {
        approved: true,
        summary: 'Approved',
        blockers: [],
        requiredAdjustments: [],
      },
    }))

    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: {
        action: 'BUY' as const,
        confidence: 0.65,
        reasoning: 'Aligned signals',
        suggestedPositionSize: 0.03,
        stopLoss: 165,
        takeProfit: 195,
      },
    }))

    const orchestrator = new Orchestrator({
      dataFetcher,
      technicalAnalyzer,
      researcherTeam: [bullResearcher, bearResearcher],
      tradePlanner,
      riskTeam: [riskAnalyst, riskManager],
      manager,
      dataQualityAssessor: new DataQualityAssessor({ llm }),
      fundamentalsScorer: new FundamentalsScorer(),
      evidenceValidator: new EvidenceValidator({ llm }),
      conflictDetector: new ConflictDetector({ llm }),
      conflictResolver: new ConflictResolver({ llm }),
      proposalValidator: new ProposalValidator(),
    })

    const result = await orchestrator.run('AAPL', 'US')

    expect(result.dataQuality).toBeDefined()
    expect(result.fundamentalScores).toBeDefined()
    expect(result.evidenceValidations).toBeDefined()
    expect(result.proposalValidation).toBeDefined()
    expect(result.proposalValidation!.valid).toBe(true)
    expect(result.finalDecision).toBeDefined()
  })

  it('flags data quality issues when data is sparse', async () => {
    const llm = mockLLM({
      advisory: 'Fundamentals severely incomplete.',
    })

    const dataFetcher = mockAgent('dataFetcher', 'data', (r) => ({
      ...r,
      rawData: [
        {
          ticker: 'AAPL',
          market: 'US',
          type: 'ohlcv',
          data: [{ date: '2026-04-07', open: 100, high: 105, low: 99, close: 103, volume: 1000000 }],
          fetchedAt: new Date(),
        },
        {
          ticker: 'AAPL',
          market: 'US',
          type: 'fundamentals',
          data: { pe: 25 },
          fetchedAt: new Date(),
        },
      ] as DataResult[],
    }))

    const technicalAnalyzer = mockAgent('technicalAnalyzer', 'data', (r) => ({
      ...r,
      computedIndicators: {
        trend: { sma50: 170, sma200: 160, ema12: 175, ema26: 170, macd: { line: 5, signal: 3, histogram: 2 } },
        momentum: { rsi: 55, stochastic: { k: 60, d: 55 } },
        volatility: { bollingerUpper: 185, bollingerMiddle: 175, bollingerLower: 165, atr: 3.5, historicalVolatility: 0.25 },
        volume: { obv: 1000000 },
        risk: { beta: 1.1, maxDrawdown: 0.12, var95: 0.02 },
        fundamentals: { pe: 25, pb: null, dividendYield: null, eps: null },
      },
    }))

    const bullResearcher = mockAgent('bullResearcher', 'researcher', (r) => ({
      ...r,
      researchFindings: [
        ...r.researchFindings,
        {
          agentName: 'bullResearcher',
          stance: 'bull' as const,
          evidence: ['RSI at 55'],
          confidence: 0.7,
        },
      ],
    }))

    const bearResearcher = mockAgent('bearResearcher', 'researcher', (r) => ({
      ...r,
      researchFindings: [
        ...r.researchFindings,
        {
          agentName: 'bearResearcher',
          stance: 'bear' as const,
          evidence: ['High risk'],
          confidence: 0.5,
        },
      ],
    }))

    const tradePlanner = mockAgent('tradePlanner', 'trader', (r) => ({
      ...r,
      traderProposal: {
        action: 'HOLD' as const,
        confidence: 0.5,
        summary: 'Hold pending more data',
        entryLogic: 'Insufficient data',
        whyNow: 'Waiting',
        timeHorizon: 'swing' as const,
        invalidationConditions: [],
      },
      researchThesis: {
        stance: 'neutral' as const,
        confidence: 0.5,
        summary: 'Insufficient data',
        keyDrivers: [],
        keyRisks: [],
        invalidationConditions: [],
        timeHorizon: 'swing' as const,
      },
    }))

    const riskAnalyst = mockAgent('riskAnalyst', 'risk', (r) => ({
      ...r,
      riskAssessment: {
        riskLevel: 'high' as const,
        metrics: { VaR: 0.05, volatility: 0.5, beta: 1.5, maxDrawdown: 0.2 },
      },
    }))

    const riskManager = mockAgent('riskManager', 'risk', (r) => ({
      ...r,
      riskVerdict: {
        approved: false,
        summary: 'Insufficient data for approval',
        blockers: ['Fundamentals incomplete'],
        requiredAdjustments: ['Gather more fundamental data'],
      },
    }))

    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: {
        action: 'HOLD' as const,
        confidence: 0.5,
        reasoning: 'Waiting for data',
      },
    }))

    const orchestrator = new Orchestrator({
      dataFetcher,
      technicalAnalyzer,
      researcherTeam: [bullResearcher, bearResearcher],
      tradePlanner,
      riskTeam: [riskAnalyst, riskManager],
      manager,
      dataQualityAssessor: new DataQualityAssessor({ llm }),
      fundamentalsScorer: new FundamentalsScorer(),
      evidenceValidator: new EvidenceValidator({ llm }),
      conflictDetector: new ConflictDetector({ llm }),
      conflictResolver: new ConflictResolver({ llm }),
      proposalValidator: new ProposalValidator(),
    })

    const result = await orchestrator.run('AAPL', 'US')

    expect(result.dataQuality).toBeDefined()
    expect(result.dataQuality!.fundamentals.completeness).toBeLessThan(1)
    expect(result.riskVerdict?.approved).toBe(false)
    expect(result.finalDecision?.action).toBe('HOLD')
  })

  it('detects evidence violations in research findings', async () => {
    const llm = mockLLM({
      advisory: 'All data available.',
      evidence: JSON.stringify({
        agentName: 'bullResearcher',
        valid: false,
        violations: ['Claim about earnings not supported by data'],
        groundedEvidence: ['RSI at 55'],
        ungroundedClaims: ['Earnings beat expected next quarter'],
      }),
      conflict: JSON.stringify({ isContradiction: false, severity: 'low' }),
    })

    const dataFetcher = mockAgent('dataFetcher', 'data', (r) => ({
      ...r,
      rawData: [
        {
          ticker: 'AAPL',
          market: 'US',
          type: 'ohlcv',
          data: [{ date: '2026-04-07', open: 100, high: 105, low: 99, close: 103, volume: 1000000 }],
          fetchedAt: new Date(),
        },
      ] as DataResult[],
    }))

    const technicalAnalyzer = mockAgent('technicalAnalyzer', 'data', (r) => ({
      ...r,
      computedIndicators: {
        trend: { sma50: 170, sma200: 160, ema12: 175, ema26: 170, macd: { line: 5, signal: 3, histogram: 2 } },
        momentum: { rsi: 55, stochastic: { k: 60, d: 55 } },
        volatility: { bollingerUpper: 185, bollingerMiddle: 175, bollingerLower: 165, atr: 3.5, historicalVolatility: 0.25 },
        volume: { obv: 1000000 },
        risk: { beta: 1.1, maxDrawdown: 0.12, var95: 0.02 },
        fundamentals: { pe: null, pb: null, dividendYield: null, eps: null },
      },
    }))

    const bullResearcher = mockAgent('bullResearcher', 'researcher', (r) => ({
      ...r,
      researchFindings: [
        ...r.researchFindings,
        {
          agentName: 'bullResearcher',
          stance: 'bull' as const,
          evidence: ['RSI at 55', 'Earnings beat expected next quarter'],
          confidence: 0.8,
        },
      ],
    }))

    const bearResearcher = mockAgent('bearResearcher', 'researcher', (r) => ({
      ...r,
      researchFindings: [
        ...r.researchFindings,
        {
          agentName: 'bearResearcher',
          stance: 'bear' as const,
          evidence: ['Valuation concerns'],
          confidence: 0.4,
        },
      ],
    }))

    const tradePlanner = mockAgent('tradePlanner', 'trader', (r) => ({
      ...r,
      traderProposal: {
        action: 'BUY' as const,
        confidence: 0.6,
        summary: 'Buy',
        entryLogic: 'Above 180',
        whyNow: 'Momentum',
        timeHorizon: 'swing' as const,
        referencePrice: 175,
        stopLoss: 165,
        takeProfit: 195,
        invalidationConditions: [],
      },
      researchThesis: {
        stance: 'bull' as const,
        confidence: 0.6,
        summary: 'Bullish',
        keyDrivers: ['momentum'],
        keyRisks: ['valuation'],
        invalidationConditions: [],
        timeHorizon: 'swing' as const,
      },
    }))

    const riskAnalyst = mockAgent('riskAnalyst', 'risk', (r) => ({
      ...r,
      riskAssessment: {
        riskLevel: 'medium' as const,
        metrics: { VaR: 0.025, volatility: 0.25, beta: 1.1, maxDrawdown: 0.12 },
      },
    }))

    const riskManager = mockAgent('riskManager', 'risk', (r) => ({
      ...r,
      riskVerdict: {
        approved: true,
        summary: 'Approved',
        blockers: [],
        requiredAdjustments: [],
      },
    }))

    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: {
        action: 'BUY' as const,
        confidence: 0.6,
        reasoning: 'Bullish momentum',
        suggestedPositionSize: 0.02,
        stopLoss: 165,
        takeProfit: 195,
      },
    }))

    const orchestrator = new Orchestrator({
      dataFetcher,
      technicalAnalyzer,
      researcherTeam: [bullResearcher, bearResearcher],
      tradePlanner,
      riskTeam: [riskAnalyst, riskManager],
      manager,
      dataQualityAssessor: new DataQualityAssessor({ llm }),
      fundamentalsScorer: new FundamentalsScorer(),
      evidenceValidator: new EvidenceValidator({ llm }),
      conflictDetector: new ConflictDetector({ llm }),
      conflictResolver: new ConflictResolver({ llm }),
      proposalValidator: new ProposalValidator(),
    })

    const result = await orchestrator.run('AAPL', 'US')

    expect(result.evidenceValidations).toBeDefined()
    expect(result.evidenceValidations!.length).toBeGreaterThan(0)
    expect(result.researchFindings.length).toBeGreaterThan(0)
  })
})
