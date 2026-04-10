// src/agents/base/types.ts

import type {
  DataQualityReport,
  FundamentalScores,
  EvidenceResult,
  Conflict,
  Resolution,
  ProposalValidation,
} from '../../types/quality.js'

export type AgentRole = 'researcher' | 'risk' | 'manager' | 'data' | 'trader' | 'advisor'

export type Market = 'US' | 'CN' | 'HK'

export type DataType = 'ohlcv' | 'news' | 'fundamentals' | 'technicals'

export const DATA_CRITICALITY: Record<DataType, 'critical' | 'optional'> = {
  ohlcv: 'critical',
  fundamentals: 'critical',
  technicals: 'critical',
  news: 'optional',
}

export type ComputedIndicators = {
  trend: {
    sma50: number
    sma200: number
    ema12: number
    ema26: number
    macd: { line: number; signal: number; histogram: number }
  }
  momentum: {
    rsi: number
    stochastic: { k: number; d: number }
  }
  volatility: {
    bollingerUpper: number
    bollingerMiddle: number
    bollingerLower: number
    atr: number
    historicalVolatility: number
  }
  volume: {
    obv: number
  }
  risk: {
    beta: number
    maxDrawdown: number
    var95: number
  }
  fundamentals: {
    pe: number | null
    pb: number | null
    dividendYield: number | null
    eps: number | null
  }
}

export type DataQuery = {
  ticker: string
  market: Market
  type: DataType
  from?: Date
  to?: Date
}

export type DataResult = {
  ticker: string
  market: Market
  type: DataType
  data: unknown
  fetchedAt: Date
}

export type LiveMarketSnapshot = {
  source: string
  fetchedAt: Date
  marketState?: string
  currency?: string
  regularMarketPrice?: number
  regularMarketChange?: number
  regularMarketChangePercent?: number
  regularMarketTime?: Date
  postMarketPrice?: number
  postMarketChange?: number
  postMarketChangePercent?: number
  postMarketTime?: Date
  preMarketPrice?: number
  preMarketChange?: number
  preMarketChangePercent?: number
  preMarketTime?: Date
  bid?: number
  ask?: number
  dayHigh?: number
  dayLow?: number
  fiftyTwoWeekHigh?: number
  fiftyTwoWeekLow?: number
  volume?: number
}

export type Finding = {
  agentName: string
  stance: 'bull' | 'bear' | 'neutral'
  evidence: string[]
  confidence: number // 0–1
  sentiment?: string
  fundamentalScore?: number
  keyMetrics?: Record<string, number>
}

export type RiskAssessment = {
  riskLevel: 'low' | 'medium' | 'high'
  metrics: {
    VaR: number
    volatility: number
    beta: number
    maxDrawdown: number
  }
  maxPositionSize?: number
  stopLoss?: number
  takeProfit?: number
}

export type ResearchThesis = {
  stance: 'bull' | 'bear' | 'neutral'
  confidence: number
  summary: string
  keyDrivers: string[]
  keyRisks: string[]
  invalidationConditions: string[]
  timeHorizon: 'short' | 'swing' | 'position'
}

export type TraderProposal = {
  action: ActionTier
  confidence: number
  summary: string
  entryLogic: string
  whyNow: string
  timeHorizon: ResearchThesis['timeHorizon']
  referencePrice?: number
  positionSizeFraction?: number
  stopLoss?: number
  takeProfit?: number
  invalidationConditions: string[]
}

export type RiskVerdict = {
  approved: boolean
  summary: string
  blockers: string[]
  requiredAdjustments: string[]
}

export type AnalysisArtifact = {
  stage: 'research' | 'trade' | 'risk' | 'final'
  agent: string
  summary: string
  payload: Record<string, unknown>
}

export type ActionTier = 'BUY' | 'OVERWEIGHT' | 'HOLD' | 'UNDERWEIGHT' | 'SELL'

export const ACTION_TIERS: readonly ActionTier[] = ['BUY', 'OVERWEIGHT', 'HOLD', 'UNDERWEIGHT', 'SELL'] as const

export type LessonPerspective = 'bull' | 'bear' | 'manager' | 'shared'

export type LessonSource = 'extractor' | 'reflection'

export type LessonRetrievalEvent = {
  lessonId: string
  agent: string
  perspective: LessonPerspective
  source: LessonSource
  ticker: string
  market: Market
  asOf: Date
  query: string
  rank: number
}

export type LessonUsageSummary = {
  retrievedCount: number
  retrievedByAgent: Record<string, number>
  retrievalCountByLesson: Record<string, number>
  topLessonIds: string[]
}

/** Maps each action to a directional signal: +1 bullish, 0 neutral, -1 bearish */
export const ACTION_DIRECTION: Record<ActionTier, number> = {
  BUY: 1,
  OVERWEIGHT: 0.5,
  HOLD: 0,
  UNDERWEIGHT: -0.5,
  SELL: -1,
}

export type Decision = {
  action: ActionTier
  confidence: number // 0–1
  reasoning: string
  suggestedPositionSize?: number
  stopLoss?: number
  takeProfit?: number
  agentWeights?: Record<string, number>
}

export type TradingReport = {
  ticker: string
  market: Market
  timestamp: Date
  rawData: DataResult[]
  liveMarketSnapshot?: LiveMarketSnapshot
  computedIndicators?: ComputedIndicators
  researchFindings: Finding[]
  researchThesis?: ResearchThesis
  traderProposal?: TraderProposal
  riskAssessment?: RiskAssessment
  riskVerdict?: RiskVerdict
  finalDecision?: Decision
  analysisArtifacts?: AnalysisArtifact[]
  lessonRetrievals?: LessonRetrievalEvent[]
  dataQuality?: DataQualityReport
  fundamentalScores?: FundamentalScores
  evidenceValidations?: EvidenceResult[]
  conflicts?: Conflict[]
  conflictResolutions?: Resolution[]
  proposalValidation?: ProposalValidation
}
