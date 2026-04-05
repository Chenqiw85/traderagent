// src/agents/advisor/AdvisorAgent.ts

import PQueue from 'p-queue'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IDataSource } from '../../data/IDataSource.js'
import type { IMessageSender } from '../../messaging/IMessageSender.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator.js'
import type { AdvisorReport, IndexDef, MarketTrend, TickerAdvisory, WatchlistEntry } from './types.js'
import { MarketTrendAnalyzer } from './MarketTrendAnalyzer.js'
import { formatAdvisorReport } from './ReportFormatter.js'
import { parseJson } from '../../utils/parseJson.js'
import { getErrorMessage } from '../../utils/errors.js'
import { createLogger } from '../../utils/logger.js'
import { withLanguage } from '../../utils/i18n.js'

const log = createLogger('advisor-agent')

type AdvisorAgentConfig = {
  readonly llm: ILLMProvider
  readonly trendLlm: ILLMProvider
  readonly dataSource: IDataSource
  readonly orchestrator: Orchestrator
  readonly messageSender?: IMessageSender
  readonly whatsappTo?: string
  readonly indices: readonly IndexDef[]
  readonly concurrency?: number
}

export class AdvisorAgent {
  private readonly llm: ILLMProvider
  private readonly trendAnalyzer: MarketTrendAnalyzer
  private readonly orchestrator: Orchestrator
  private readonly messageSender?: IMessageSender
  private readonly whatsappTo?: string
  private readonly indices: readonly IndexDef[]
  private readonly concurrency: number

  constructor(config: AdvisorAgentConfig) {
    this.llm = config.llm
    this.trendAnalyzer = new MarketTrendAnalyzer({
      llm: config.trendLlm,
      dataSource: config.dataSource,
    })
    this.orchestrator = config.orchestrator
    this.messageSender = config.messageSender
    this.whatsappTo = config.whatsappTo
    this.indices = config.indices
    this.concurrency = config.concurrency ?? 3
  }

  async run(watchlist: readonly WatchlistEntry[]): Promise<AdvisorReport> {
    log.info('Starting analysis')

    // Stage 1: Analyze market trends across indices
    log.info({ count: this.indices.length }, 'Analyzing market indices')
    const marketTrends = await this.trendAnalyzer.analyze(this.indices)
    log.info({ count: marketTrends.length }, 'Completed index analyses')

    // Stage 2: Run full pipeline for each watchlist ticker (parallel with concurrency limit)
    const tickerAdvisories: TickerAdvisory[] = []
    const queue = new PQueue({ concurrency: this.concurrency })

    const tasks = watchlist.map((entry) =>
      queue.add(async () => {
        try {
          log.info({ ticker: entry.ticker, market: entry.market }, 'Running pipeline')
          const report = await this.orchestrator.run(entry.ticker, entry.market)
          if (report.finalDecision) {
            tickerAdvisories.push({
              ticker: entry.ticker,
              market: entry.market,
              decision: report.finalDecision,
              keyFindings: report.researchFindings
                .filter((f) => f.confidence >= 0.5)
                .map((f) => `${f.agentName}: ${f.stance} (${(f.confidence * 100).toFixed(0)}%)`),
            })
          }
        } catch (err) {
          log.error({ ticker: entry.ticker, error: getErrorMessage(err) }, 'Pipeline failed')
        }
      })
    )
    await Promise.all(tasks)

    // Stage 3: LLM synthesis — combine everything into advisory summary
    const summary = await this.synthesize(marketTrends, tickerAdvisories)

    const advisorReport: AdvisorReport = {
      timestamp: new Date(),
      marketTrends,
      tickerAdvisories,
      summary,
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
      .map((a) => `${a.ticker}: ${a.decision.action} (${(a.decision.confidence * 100).toFixed(0)}%) — ${a.decision.reasoning}`)
      .join('\n')

    const response = await this.llm.chat([
      {
        role: 'system',
        content: withLanguage(`You are a senior market advisor synthesizing a daily briefing.

MARKET INDICES:
${trendBlock}

TICKER RECOMMENDATIONS:
${advisoryBlock || '(no tickers analyzed today)'}

Write a concise 3-5 sentence market advisory summary. Include:
1. Overall market sentiment (bullish/bearish/mixed)
2. Key risks or opportunities
3. Any notable divergences between US and China markets

Respond with ONLY a JSON object:
{"summary": "<your advisory summary>"}`),
      },
      { role: 'user', content: 'Synthesize the daily advisory. JSON only.' },
    ])

    const parsed = parseJson<{ summary?: string }>(response)
    return parsed.summary ?? 'Unable to generate advisory summary.'
  }
}
