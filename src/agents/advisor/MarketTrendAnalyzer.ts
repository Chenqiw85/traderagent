// src/agents/advisor/MarketTrendAnalyzer.ts

import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IDataSource } from '../../data/IDataSource.js'
import type { IndexDef, MarketTrend } from './types.js'
import {
  calcSMA, calcEMA, calcMACD,
  calcRSI,
} from '../../indicators/index.js'
import { parseJson } from '../../utils/parseJson.js'
import { normalizeOhlcv } from '../../utils/normalizeOhlcv.js'

type MarketTrendAnalyzerConfig = {
  readonly llm: ILLMProvider
  readonly dataSource: IDataSource
}

export class MarketTrendAnalyzer {
  private readonly llm: ILLMProvider
  private readonly dataSource: IDataSource

  constructor(config: MarketTrendAnalyzerConfig) {
    this.llm = config.llm
    this.dataSource = config.dataSource
  }

  async analyze(indices: readonly IndexDef[]): Promise<MarketTrend[]> {
    const trends: MarketTrend[] = []

    for (const index of indices) {
      try {
        const trend = await this.analyzeIndex(index)
        trends.push(trend)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[MarketTrendAnalyzer] Failed to analyze ${index.ticker}: ${msg}`)
      }
    }

    return trends
  }

  private async analyzeIndex(index: IndexDef): Promise<MarketTrend> {
    const now = new Date()
    const result = await this.dataSource.fetch({
      ticker: index.ticker,
      market: index.market,
      type: 'ohlcv',
      from: new Date(now.getTime() - 365 * 86400000),
      to: now,
    })

    const bars = this.parseBars(result.data)
    if (bars.length < 30) {
      throw new Error(`Insufficient data for ${index.ticker}: ${bars.length} bars`)
    }

    const closes = bars.map((b) => b.close)
    const latestClose = closes[closes.length - 1]
    const prevClose = closes[closes.length - 2]
    const changePercent = prevClose > 0 ? ((latestClose - prevClose) / prevClose) * 100 : 0

    const rsi = calcRSI(closes, 14)
    const macd = calcMACD(closes)
    const sma50 = calcSMA(closes, 50)
    const sma200 = calcSMA(closes, 200)

    const direction = this.inferDirection(latestClose, sma50, sma200, rsi, macd.histogram)

    const indicatorBlock = [
      `${index.name} (${index.ticker}):`,
      `  Close: $${latestClose.toFixed(2)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`,
      `  RSI: ${rsi.toFixed(1)}`,
      `  MACD histogram: ${macd.histogram.toFixed(3)}`,
      `  SMA50: $${sma50.toFixed(2)}  SMA200: $${sma200.toFixed(2)}`,
      `  Price vs SMA50: ${latestClose > sma50 ? 'above' : 'below'}`,
      `  Price vs SMA200: ${latestClose > sma200 ? 'above' : 'below'}`,
    ].join('\n')

    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are a market analyst. Summarize the trend for this index in 1-2 sentences based ONLY on the data below.\n\n${indicatorBlock}\n\nRespond with ONLY a JSON object:\n{"summary": "<1-2 sentence summary>"}`,
      },
      { role: 'user', content: `Summarize the trend for ${index.name}. JSON only.` },
    ])

    const parsed = parseJson<{ summary?: string }>(response)

    return {
      ticker: index.ticker,
      name: index.name,
      market: index.market,
      latestClose,
      changePercent,
      direction,
      rsi,
      macdHistogram: macd.histogram,
      sma50,
      sma200,
      summary: parsed.summary ?? `${index.name} is ${direction}`,
    }
  }

  private inferDirection(
    close: number,
    sma50: number,
    sma200: number,
    rsi: number,
    macdHist: number,
  ): MarketTrend['direction'] {
    let score = 0
    if (close > sma50) score += 1
    if (close > sma200) score += 1
    if (rsi > 50) score += 1
    if (macdHist > 0) score += 1
    if (score >= 3) return 'bullish'
    if (score <= 1) return 'bearish'
    return 'neutral'
  }

  private parseBars(data: unknown) {
    return normalizeOhlcv(data)
  }
}
