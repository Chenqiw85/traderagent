// src/agents/advisor/DailyUpdateAnalyzer.ts

import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IDataSource } from '../../data/IDataSource.js'
import type { Market, TradingReport, Decision, ActionTier } from '../base/types.js'
import type { DailyTickerUpdate, IndicatorDelta } from './types.js'
import { ReportLoader } from './ReportLoader.js'
import { calcRSI, calcMACD, calcSMA } from '../../indicators/index.js'
import { normalizeOhlcv } from '../../utils/normalizeOhlcv.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('daily-update')

type DailyUpdateAnalyzerConfig = {
  readonly llm: ILLMProvider
  readonly dataSource: IDataSource
  readonly reportLoader: ReportLoader
}

type LLMUpdateResponse = {
  action: ActionTier
  confidence: number
  reasoning: string
  deltaReasoning: string
  newsSummary: string
  stopLoss?: number
  takeProfit?: number
}

export class DailyUpdateAnalyzer {
  private readonly llm: ILLMProvider
  private readonly dataSource: IDataSource
  private readonly reportLoader: ReportLoader

  constructor(config: DailyUpdateAnalyzerConfig) {
    this.llm = config.llm
    this.dataSource = config.dataSource
    this.reportLoader = config.reportLoader
  }

  async analyze(ticker: string, market: Market): Promise<DailyTickerUpdate | null> {
    // 1. Load previous report
    const loaded = await this.reportLoader.loadLatest(ticker, market)
    if (!loaded) {
      log.info({ ticker, market }, 'No previous report — skipping')
      return null
    }

    const { report: prevReport } = loaded
    if (!prevReport.finalDecision) {
      log.info({ ticker, market }, 'Previous report has no decision — skipping')
      return null
    }

    // 2. Fetch daily news
    const newsArticles = await this.fetchDailyNews(ticker, market)

    // 3. Fetch latest OHLCV and compute current indicators
    const indicatorDelta = await this.computeIndicatorDelta(ticker, market, prevReport)
    if (!indicatorDelta) {
      log.warn({ ticker }, 'Could not compute indicator delta — skipping')
      return null
    }

    // 4. LLM: synthesize update
    const updatedDecision = await this.synthesizeUpdate(
      ticker,
      market,
      prevReport,
      indicatorDelta,
      newsArticles,
    )

    return {
      ticker,
      market,
      previousDecision: prevReport.finalDecision,
      indicatorDelta,
      newsSummary: updatedDecision.newsSummary,
      updatedDecision: {
        action: updatedDecision.action,
        confidence: updatedDecision.confidence,
        reasoning: updatedDecision.reasoning,
        stopLoss: updatedDecision.stopLoss,
        takeProfit: updatedDecision.takeProfit,
      },
      deltaReasoning: updatedDecision.deltaReasoning,
    }
  }

  private async fetchDailyNews(ticker: string, market: Market): Promise<string[]> {
    try {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const result = await this.dataSource.fetch({
        ticker,
        market,
        type: 'news',
        from: yesterday,
        to: now,
      })

      const articles = result.data as Array<{ title?: string; description?: string }> | undefined
      if (!articles || !Array.isArray(articles)) return []

      return articles
        .slice(0, 10)
        .map((a) => `${a.title ?? ''}${a.description ? ` — ${a.description}` : ''}`)
        .filter((s) => s.length > 0)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn({ ticker, error: msg }, 'Failed to fetch daily news')
      return []
    }
  }

  private async computeIndicatorDelta(
    ticker: string,
    market: Market,
    prevReport: TradingReport,
  ): Promise<IndicatorDelta | null> {
    try {
      const now = new Date()
      const result = await this.dataSource.fetch({
        ticker,
        market,
        type: 'ohlcv',
        from: new Date(now.getTime() - 90 * 86400000), // 90 days for SMA computation
        to: now,
      })

      const bars = normalizeOhlcv(result.data)
      if (bars.length < 30) {
        log.warn({ ticker, bars: bars.length }, 'Insufficient OHLCV data for indicators')
        return null
      }

      const closes = bars.map((b) => b.close)
      const closeNow = closes[closes.length - 1]
      const rsiNow = calcRSI(closes, 14)
      const macdNow = calcMACD(closes)
      const sma50Now = calcSMA(closes, 50)
      const sma200Now = calcSMA(closes, 200)

      // Previous indicators from report
      const prev = prevReport.computedIndicators
      const closePrev = prev?.trend.sma50 ? closes[closes.length - 2] : closeNow // best estimate
      const rsiPrev = prev?.momentum.rsi ?? rsiNow
      const macdHistPrev = prev?.trend.macd.histogram ?? macdNow.histogram
      const sma50Prev = prev?.trend.sma50 ?? sma50Now
      const sma200Prev = prev?.trend.sma200 ?? sma200Now

      // Use actual previous close if available from OHLCV data
      const actualClosePrev = closes.length >= 2 ? closes[closes.length - 2] : closeNow
      const changePercent = actualClosePrev > 0
        ? ((closeNow - actualClosePrev) / actualClosePrev) * 100
        : 0

      return {
        rsiPrev,
        rsiNow,
        macdHistPrev,
        macdHistNow: macdNow.histogram,
        sma50Prev,
        sma50Now,
        sma200Prev,
        sma200Now,
        closePrev: actualClosePrev,
        closeNow,
        changePercent,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn({ ticker, error: msg }, 'Failed to compute indicators')
      return null
    }
  }

  private async synthesizeUpdate(
    ticker: string,
    market: Market,
    prevReport: TradingReport,
    delta: IndicatorDelta,
    newsArticles: string[],
  ): Promise<LLMUpdateResponse> {
    const prevDecision = prevReport.finalDecision!
    const thesis = prevReport.researchThesis

    const prevBlock = [
      `Previous Analysis (${prevReport.timestamp.toISOString?.() ?? 'unknown date'}):`,
      `  Action: ${prevDecision.action} (${(prevDecision.confidence * 100).toFixed(0)}% confidence)`,
      `  Reasoning: ${prevDecision.reasoning}`,
      prevDecision.stopLoss != null ? `  Stop Loss: $${prevDecision.stopLoss}` : '',
      prevDecision.takeProfit != null ? `  Take Profit: $${prevDecision.takeProfit}` : '',
      thesis ? `  Thesis: ${thesis.stance} — ${thesis.summary}` : '',
      thesis?.keyDrivers.length ? `  Key Drivers: ${thesis.keyDrivers.join('; ')}` : '',
      thesis?.keyRisks.length ? `  Key Risks: ${thesis.keyRisks.join('; ')}` : '',
      thesis?.invalidationConditions.length ? `  Invalidation: ${thesis.invalidationConditions.join('; ')}` : '',
    ].filter(Boolean).join('\n')

    const deltaBlock = [
      `Indicator Changes (previous → now):`,
      `  Price: $${delta.closePrev.toFixed(2)} → $${delta.closeNow.toFixed(2)} (${delta.changePercent >= 0 ? '+' : ''}${delta.changePercent.toFixed(2)}%)`,
      `  RSI: ${delta.rsiPrev.toFixed(1)} → ${delta.rsiNow.toFixed(1)}`,
      `  MACD Histogram: ${delta.macdHistPrev.toFixed(3)} → ${delta.macdHistNow.toFixed(3)}`,
      `  SMA50: $${delta.sma50Prev.toFixed(2)} → $${delta.sma50Now.toFixed(2)}`,
      `  SMA200: $${delta.sma200Prev.toFixed(2)} → $${delta.sma200Now.toFixed(2)}`,
      `  Price vs SMA50: ${delta.closeNow > delta.sma50Now ? 'above' : 'below'}`,
      `  Price vs SMA200: ${delta.closeNow > delta.sma200Now ? 'above' : 'below'}`,
    ].join('\n')

    const newsBlock = newsArticles.length > 0
      ? `Today's News:\n${newsArticles.map((n, i) => `  ${i + 1}. ${n}`).join('\n')}`
      : 'Today\'s News: No significant news articles found.'

    const riskBlock = prevReport.riskAssessment
      ? [
          `Previous Risk Assessment:`,
          `  Risk Level: ${prevReport.riskAssessment.riskLevel}`,
          `  VaR(95%): ${(prevReport.riskAssessment.metrics.VaR * 100).toFixed(2)}%`,
          `  Beta: ${prevReport.riskAssessment.metrics.beta.toFixed(2)}`,
          `  Max Drawdown: ${(prevReport.riskAssessment.metrics.maxDrawdown * 100).toFixed(1)}%`,
        ].join('\n')
      : ''

    const prompt = withLanguage(`You are a senior market advisor providing a daily update for ${ticker} (${market}).

You have a PREVIOUS analysis and need to determine if today's new data changes the recommendation.

${prevBlock}

${riskBlock}

${deltaBlock}

${newsBlock}

INSTRUCTIONS:
1. Assess whether the new data (price changes, indicator shifts, news) MATERIALLY changes the previous thesis
2. If invalidation conditions from the previous analysis are triggered, change the recommendation
3. If stop loss or take profit levels are breached, update accordingly
4. Consider news impact: HIGH (earnings, regulatory), MEDIUM (analyst actions), LOW (noise)
5. Be conservative — only change the recommendation if there's strong evidence
6. Provide clear delta reasoning: what changed and why it matters (or doesn't)

Respond with ONLY a JSON object:
{
  "action": "BUY" | "OVERWEIGHT" | "HOLD" | "UNDERWEIGHT" | "SELL",
  "confidence": <number 0-1>,
  "reasoning": "<updated reasoning incorporating new data>",
  "deltaReasoning": "<what changed since last analysis and why it matters>",
  "newsSummary": "<1-2 sentence summary of today's news impact, or 'No significant news'>",
  "stopLoss": <number or null>,
  "takeProfit": <number or null>
}`)

    const response = await this.llm.chat([
      { role: 'system', content: prompt },
      { role: 'user', content: `Provide the daily update for ${ticker}. JSON only.` },
    ])

    const parsed = parseJson<LLMUpdateResponse>(response)

    return {
      action: parsed.action ?? prevDecision.action,
      confidence: parsed.confidence ?? prevDecision.confidence,
      reasoning: parsed.reasoning ?? prevDecision.reasoning,
      deltaReasoning: parsed.deltaReasoning ?? 'No significant changes detected.',
      newsSummary: parsed.newsSummary ?? 'No significant news.',
      stopLoss: parsed.stopLoss ?? prevDecision.stopLoss,
      takeProfit: parsed.takeProfit ?? prevDecision.takeProfit,
    }
  }
}
