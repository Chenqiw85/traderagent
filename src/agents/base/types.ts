// src/agents/base/types.ts

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
  computedIndicators?: ComputedIndicators
  researchFindings: Finding[]
  riskAssessment?: RiskAssessment
  finalDecision?: Decision
}
