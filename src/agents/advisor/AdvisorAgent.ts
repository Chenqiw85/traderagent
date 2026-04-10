// src/agents/advisor/AdvisorAgent.ts

import PQueue from 'p-queue'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IMessageSender } from '../../messaging/IMessageSender.js'
import type { ComputedIndicators, Decision, Market, ResearchThesis, RiskAssessment, RiskVerdict } from '../base/types.js'
import type {
  AdvisorReport,
  BaselineAnalysis,
  FreshMarketOverlay,
  IndexDef,
  MarketTrend,
  NextDayForecast,
  TickerAdvisory,
  WatchlistEntry,
} from './types.js'
import { formatAdvisorReport } from './ReportFormatter.js'
import { parseJson } from '../../utils/parseJson.js'
import { getErrorMessage } from '../../utils/errors.js'
import { createLogger } from '../../utils/logger.js'
import { withLanguage } from '../../utils/i18n.js'
import { nextTradingSessionDate } from './tradingCalendar.js'

const log = createLogger('advisor-agent')

function projectDecisionFromForecast(forecast: NextDayForecast): Decision {
  const action: Decision['action'] =
    forecast.predictedDirection === 'down'
      ? 'SELL'
      : forecast.predictedDirection === 'flat'
        ? 'HOLD'
        : 'BUY'

  return {
    action,
    confidence: forecast.confidence,
    reasoning: forecast.reasoning,
  }
}

type AdvisorAgentConfig = {
  readonly llm: ILLMProvider
  readonly trendAnalyzer: {
    analyze(indices: readonly IndexDef[]): Promise<MarketTrend[]>
  }
  readonly baselineService: {
    loadBaseline(input: { ticker: string; market: Market; asOf: Date; ragMode?: string }): Promise<BaselineAnalysis>
  }
  readonly overlayBuilder: {
    build(input: { ticker: string; market: Market; asOf: Date }): Promise<FreshMarketOverlay>
  }
  readonly forecastSynthesizer: {
    synthesize(input: {
      ticker: string
      market: Market
      targetSession: Date
      baselineAction: NextDayForecast['baselineAction']
      baselineReferencePrice?: number
      latestClose: number
      previousClose: number
      changePercent: number
      newsItems: string[]
      baselineSummary: string
      overlaySummary: string
      indicators: ComputedIndicators
      baselineThesis?: ResearchThesis
      baselineRiskAssessment?: RiskAssessment
      baselineRiskVerdict?: RiskVerdict
      marketTrends: readonly MarketTrend[]
    }): Promise<NextDayForecast>
  }
  readonly messageSender?: IMessageSender
  readonly whatsappTo?: string
  readonly indices: readonly IndexDef[]
  readonly concurrency?: number
  readonly ragMode?: string
  readonly forecastRepository?: {
    saveMany(input: { issuedAt: Date; advisories: readonly TickerAdvisory[] }): Promise<void>
  }
}

export class AdvisorAgent {
  private readonly llm: ILLMProvider
  private readonly trendAnalyzer: AdvisorAgentConfig['trendAnalyzer']
  private readonly baselineService: AdvisorAgentConfig['baselineService']
  private readonly overlayBuilder: AdvisorAgentConfig['overlayBuilder']
  private readonly forecastSynthesizer: AdvisorAgentConfig['forecastSynthesizer']
  private readonly messageSender?: IMessageSender
  private readonly whatsappTo?: string
  private readonly indices: readonly IndexDef[]
  private readonly concurrency: number
  private readonly ragMode?: string
  private readonly forecastRepository?: AdvisorAgentConfig['forecastRepository']

  constructor(config: AdvisorAgentConfig) {
    this.llm = config.llm
    this.trendAnalyzer = config.trendAnalyzer
    this.baselineService = config.baselineService
    this.overlayBuilder = config.overlayBuilder
    this.forecastSynthesizer = config.forecastSynthesizer
    this.messageSender = config.messageSender
    this.whatsappTo = config.whatsappTo
    this.indices = config.indices
    this.concurrency = config.concurrency ?? 3
    this.ragMode = config.ragMode
    this.forecastRepository = config.forecastRepository
  }

  async run(watchlist: readonly WatchlistEntry[]): Promise<AdvisorReport> {
    log.info('Starting daily advisory analysis')

    // Stage 1: Analyze market trends across indices
    log.info({ count: this.indices.length }, 'Analyzing market indices')
    const marketTrends = await this.trendAnalyzer.analyze(this.indices)
    log.info({ count: marketTrends.length }, 'Completed index analyses')

    // Stage 2: Forecast the next session for each watchlist ticker from a baseline analysis plus a fresh overlay.
    const asOf = new Date()
    const targetSession = nextTradingSessionDate(asOf)
    const tickerAdvisories: TickerAdvisory[] = []
    const queue = new PQueue({ concurrency: this.concurrency })

    const tasks = watchlist.map((entry) =>
      queue.add(async () => {
        try {
          log.info({ ticker: entry.ticker, market: entry.market }, 'Building next-session advisory')
          const baseline = await this.baselineService.loadBaseline({
            ticker: entry.ticker,
            market: entry.market,
            asOf,
            ragMode: this.ragMode,
          })
          const decision = baseline.report.finalDecision
          if (!decision) {
            throw new Error(`AdvisorAgent: baseline report for ${entry.ticker} is missing finalDecision`)
          }
          const baselineSummary = baseline.report.researchThesis?.summary ?? decision.reasoning
          const baselineReferencePrice = decision.action === 'HOLD'
            ? undefined
            : baseline.report.traderProposal?.referencePrice
          const overlay = await this.overlayBuilder.build({
            ticker: entry.ticker,
            market: entry.market,
            asOf,
          })
          const forecast = await this.forecastSynthesizer.synthesize({
            ticker: entry.ticker,
            market: entry.market,
            targetSession,
            baselineAction: decision.action,
            baselineReferencePrice,
            latestClose: overlay.latestClose,
            previousClose: overlay.previousClose,
            changePercent: overlay.changePercent,
            newsItems: overlay.newsItems,
            baselineSummary,
            overlaySummary: this.describeOverlay(overlay),
            indicators: overlay.indicators,
            baselineThesis: baseline.report.researchThesis,
            baselineRiskAssessment: baseline.report.riskAssessment,
            baselineRiskVerdict: baseline.report.riskVerdict,
            marketTrends,
          })

          tickerAdvisories.push({
            ticker: entry.ticker,
            market: entry.market,
            decision: projectDecisionFromForecast(forecast),
            keyFindings: [
              `Baseline action: ${decision.action}`,
              `Baseline thesis: ${baselineSummary}`,
              `Fresh move: ${overlay.changePercent >= 0 ? '+' : ''}${overlay.changePercent.toFixed(2)}%`,
            ],
            forecast,
            baselineAsOf: baseline.asOf,
            baselineSource: baseline.source,
            baselineDecision: decision,
            baselineProposal: baseline.report.traderProposal,
            baselineThesis: baseline.report.researchThesis,
            baselineRiskVerdict: baseline.report.riskVerdict,
          })
        } catch (err) {
          log.error({ ticker: entry.ticker, error: getErrorMessage(err) }, 'Advisor forecast failed')
        }
      })
    )
    await Promise.all(tasks)

    // Stage 3: LLM synthesis — combine everything into advisory summary
    const summary = await this.synthesize(marketTrends, tickerAdvisories)

    const advisorReport: AdvisorReport = {
      timestamp: asOf,
      marketTrends,
      tickerAdvisories,
      summary,
    }

    if (this.forecastRepository) {
      try {
        await this.forecastRepository.saveMany({
          issuedAt: advisorReport.timestamp,
          advisories: advisorReport.tickerAdvisories,
        })
      } catch (err) {
        log.error({ error: getErrorMessage(err) }, 'Failed to persist advisor forecasts')
      }
    }

    // Stage 4: Send via WhatsApp if configured
    if (this.messageSender && this.whatsappTo) {
      try {
        const formatted = formatAdvisorReport(advisorReport)
        await this.messageSender.send(this.whatsappTo, formatted)
        const maskedTo = this.whatsappTo.replace(/\d(?=\d{4})/g, '*')
        log.info({ to: maskedTo }, 'Report sent')
      } catch (err) {
        log.error({ error: getErrorMessage(err) }, 'Failed to send WhatsApp message')
      }
    }

    return advisorReport
  }

  private async synthesize(
    trends: readonly MarketTrend[],
    advisories: readonly TickerAdvisory[],
  ): Promise<string> {
    const trendBlock = trends
      .map((t) => `${t.name} (${t.ticker}): ${t.direction}, ${t.changePercent >= 0 ? '+' : ''}${t.changePercent.toFixed(2)}%, RSI=${t.rsi.toFixed(0)}`)
      .join('\n')

    const advisoryBlock = advisories
      .map((a) => {
        if (a.forecast) {
          return [
            `${a.ticker}: baseline ${a.baselineDecision?.action ?? a.decision.action} (${((a.baselineDecision?.confidence ?? a.decision.confidence) * 100).toFixed(0)}%)`,
            `next session ${a.forecast.predictedDirection} from $${a.forecast.referencePrice.toFixed(2)} (${(a.forecast.confidence * 100).toFixed(0)}%)`,
            `${a.forecast.reasoning}`,
          ].join(' — ')
        }

        const delta = a.dailyUpdate
          ? ` [was: ${a.dailyUpdate.previousDecision.action}, change: ${a.dailyUpdate.indicatorDelta.changePercent >= 0 ? '+' : ''}${a.dailyUpdate.indicatorDelta.changePercent.toFixed(2)}%]`
          : ''
        return `${a.ticker}: ${a.decision.action} (${(a.decision.confidence * 100).toFixed(0)}%) — ${a.decision.reasoning}${delta}`
      })
      .join('\n')

    const response = await this.llm.chat([
      {
        role: 'system',
        content: withLanguage(`You are a senior market advisor synthesizing a next-session briefing.

MARKET INDICES:
${trendBlock}

TICKER FORECASTS (baseline full analysis plus latest completed daily bar + fresh live-price overlay for the next session):
${advisoryBlock || '(no tickers analyzed today)'}

Write a concise 3-5 sentence market advisory summary. Include:
1. Overall market sentiment (bullish/bearish/mixed)
2. Key risks or opportunities
3. Any notable divergences between US and China markets
4. Highlight how the baseline action compares with the next-session forecast

Respond with ONLY a JSON object:
{"summary": "<your advisory summary>"}`),
      },
      { role: 'user', content: 'Synthesize the daily advisory. JSON only.' },
    ])

    const parsed = parseJson<{ summary?: string }>(response)
    return parsed.summary ?? 'Unable to generate advisory summary.'
  }

  private describeOverlay(overlay: FreshMarketOverlay): string {
    const ind = overlay.indicators
    const macdSignal = ind.trend.macd.histogram > 0 ? 'bullish' : 'bearish'
    const rsiZone = ind.momentum.rsi > 70 ? 'overbought' : ind.momentum.rsi < 30 ? 'oversold' : 'neutral'
    const priceVsSma50 = ((overlay.latestClose - ind.trend.sma50) / ind.trend.sma50 * 100).toFixed(2)
    return [
      `Live anchor $${overlay.latestClose.toFixed(2)} vs latest close $${overlay.previousClose.toFixed(2)} (${overlay.changePercent >= 0 ? '+' : ''}${overlay.changePercent.toFixed(2)}%)`,
      `RSI ${ind.momentum.rsi.toFixed(1)} (${rsiZone}), MACD hist ${ind.trend.macd.histogram > 0 ? '+' : ''}${ind.trend.macd.histogram.toFixed(4)} (${macdSignal})`,
      `Price ${priceVsSma50}% vs SMA50, ATR ${ind.volatility.atr.toFixed(2)}`,
    ].join('; ')
  }
}
