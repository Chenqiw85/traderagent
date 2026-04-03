// src/agents/advisor/types.ts

import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IDataSource } from '../../data/IDataSource.js'
import type { IMessageSender } from '../../messaging/IMessageSender.js'
import type { Decision, Market } from '../base/types.js'

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

export const DEFAULT_INDICES: readonly IndexDef[] = [
  { ticker: 'SPY', name: 'S&P 500', market: 'US' },
  { ticker: 'QQQ', name: 'NASDAQ 100', market: 'US' },
  { ticker: 'DIA', name: 'Dow Jones', market: 'US' },
  { ticker: '^VIX', name: 'VIX', market: 'US' },
  { ticker: 'FXI', name: 'China Large-Cap', market: 'US' },
  { ticker: 'KWEB', name: 'China Internet', market: 'US' },
  { ticker: 'MCHI', name: 'MSCI China', market: 'US' },
]
