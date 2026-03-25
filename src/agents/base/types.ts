// src/agents/base/types.ts

export type AgentRole = 'researcher' | 'risk' | 'manager' | 'data'

export type Market = 'US' | 'CN' | 'HK'

export type DataType = 'ohlcv' | 'news' | 'fundamentals' | 'technicals'

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

export type Decision = {
  action: 'BUY' | 'SELL' | 'HOLD'
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
  researchFindings: Finding[]
  riskAssessment?: RiskAssessment
  finalDecision?: Decision
}
