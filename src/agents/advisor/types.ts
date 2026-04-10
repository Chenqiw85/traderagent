// src/agents/advisor/types.ts

import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IDataSource } from '../../data/IDataSource.js'
import type { IMessageSender } from '../../messaging/IMessageSender.js'
import type {
  ComputedIndicators,
  Decision,
  Market,
  ResearchThesis,
  RiskVerdict,
  TradingReport,
  TraderProposal,
} from '../base/types.js'

export type MarketTrend = {
  readonly ticker: string
  readonly name: string
  readonly market: Market
  readonly latestClose: number
  readonly changePercent: number
  readonly direction: 'bullish' | 'bearish' | 'neutral'
  readonly rsi: number
  readonly macdHistogram: number
  readonly sma50: number
  readonly sma200: number
  readonly summary: string
}

export type TickerAdvisory = {
  readonly ticker: string
  readonly market: Market
  readonly decision: Decision
  readonly keyFindings: string[]
  readonly dailyUpdate?: DailyTickerUpdate
  readonly forecast?: NextDayForecast
  readonly baselineAsOf?: Date
  readonly baselineSource?: BaselineLoadSource
  readonly baselineDecision?: Decision
  readonly baselineProposal?: TraderProposal
  readonly baselineThesis?: ResearchThesis
  readonly baselineRiskVerdict?: RiskVerdict
}

export type AdvisorReport = {
  readonly timestamp: Date
  readonly marketTrends: readonly MarketTrend[]
  readonly tickerAdvisories: readonly TickerAdvisory[]
  readonly summary: string
}

export type AdvisorConfig = {
  readonly llm: ILLMProvider
  readonly dataSource: IDataSource
  readonly messageSender?: IMessageSender
  readonly whatsappTo?: string
  readonly indices: readonly IndexDef[]
  readonly watchlist: readonly WatchlistEntry[]
}

export type IndexDef = {
  readonly ticker: string
  readonly name: string
  readonly market: Market
}

export type WatchlistEntry = {
  readonly ticker: string
  readonly market: Market
}

export type IndicatorDelta = {
  readonly rsiPrev: number
  readonly rsiNow: number
  readonly macdHistPrev: number
  readonly macdHistNow: number
  readonly sma50Prev: number
  readonly sma50Now: number
  readonly sma200Prev: number
  readonly sma200Now: number
  readonly closePrev: number
  readonly closeNow: number
  readonly changePercent: number
}

export type ForecastDirection = 'up' | 'down' | 'flat'
export type BaselineLoadSource = 'db' | 'markdown' | 'fresh-run'
export type BaselineStrength = 'strengthened' | 'weakened' | 'reversed' | 'unchanged'

export type BaselineAnalysis = {
  readonly report: TradingReport
  readonly asOf: Date
  readonly source: BaselineLoadSource
}

export type FreshMarketOverlay = {
  readonly asOf: Date
  readonly latestClose: number
  readonly previousClose: number
  readonly changePercent: number
  readonly indicators: ComputedIndicators
  readonly newsItems: string[]
}

export type NextDayForecast = {
  readonly predictedDirection: ForecastDirection
  readonly referencePrice: number
  readonly targetPrice: number
  readonly targetSession: string
  readonly confidence: number
  readonly reasoning: string
  readonly baselineAction: Decision['action']
  readonly baselineReferencePrice?: number
  readonly changeFromBaseline: BaselineStrength
}

export type DailyTickerUpdate = {
  readonly ticker: string
  readonly market: Market
  readonly previousDecision: Decision
  readonly indicatorDelta: IndicatorDelta
  readonly newsSummary: string
  readonly updatedDecision: Decision
  readonly deltaReasoning: string
}

export const DEFAULT_INDICES: readonly IndexDef[] = [
  { ticker: 'SPY', name: 'S&P 500', market: 'US' },
  { ticker: 'QQQ', name: 'NASDAQ 100', market: 'US' },
  { ticker: 'DIA', name: 'Dow Jones', market: 'US' },
  { ticker: '^VIX', name: 'VIX', market: 'US' },
  { ticker: 'FXI', name: 'China Large-Cap', market: 'US' },
  { ticker: 'KWEB', name: 'China Internet', market: 'US' },
  { ticker: 'MCHI', name: 'MSCI China', market: 'US' },
]
