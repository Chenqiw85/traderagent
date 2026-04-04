import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, DataType, Finding, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IVectorStore } from '../../rag/IVectorStore.js'
import type { IEmbedder } from '../../rag/IEmbedder.js'
import { parseJson } from '../../utils/parseJson.js'
import { normalizeOhlcv } from '../../utils/normalizeOhlcv.js'

export type ResearcherConfig = {
  llm: ILLMProvider
  vectorStore?: IVectorStore
  embedder?: IEmbedder
  topK?: number
}

export abstract class BaseResearcher implements IAgent {
  abstract readonly name: string
  abstract readonly requiredData: DataType[]
  readonly role: AgentRole = 'researcher'

  protected llm: ILLMProvider
  protected vectorStore?: IVectorStore
  protected embedder?: IEmbedder
  protected topK: number

  constructor(config: ResearcherConfig) {
    this.llm = config.llm
    this.vectorStore = config.vectorStore
    this.embedder = config.embedder
    this.topK = config.topK ?? 5
    if ((config.vectorStore == null) !== (config.embedder == null)) {
      throw new Error(
        `${this.constructor.name}: vectorStore and embedder must both be provided or both omitted`
      )
    }
  }

  async run(report: TradingReport): Promise<TradingReport> {
    // Validate required data is present
    const missing = this.requiredData.filter(
      (type) =>
        !report.rawData.some((d) => d.type === type) &&
        !(type === 'technicals' && report.computedIndicators),
    )
    if (missing.length > 0) {
      throw new Error(
        `${this.name}: cannot analyze — missing required data: ${missing.join(', ')}`,
      )
    }

    const context = await this.retrieveContext(report)
    const indicators = this.formatIndicators(report)
    const rawDataContext = this.formatRawData(report)
    const systemPrompt = this.buildSystemPrompt(report, context, rawDataContext, indicators)
    const response = await this.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analyze ${report.ticker} on the ${report.market} market. Base your analysis ONLY on the data provided above. Do not invent numbers. Respond with JSON only.` },
    ])
    const finding = this.parseFinding(response)
    return {
      ...report,
      researchFindings: [...report.researchFindings, finding],
    }
  }

  /** Format computed indicators into a human-readable block for the LLM */
  protected formatIndicators(report: TradingReport): string {
    const ci = report.computedIndicators
    if (!ci) return ''

    const lines: string[] = ['=== COMPUTED INDICATORS (calculated from real market data) ===']

    const fmt = (v: number | null, decimals = 2) =>
      v == null || isNaN(v) ? 'N/A' : v.toFixed(decimals)

    lines.push(`Trend:       SMA50=$${fmt(ci.trend.sma50)}  SMA200=$${fmt(ci.trend.sma200)}  MACD=${fmt(ci.trend.macd.line)} (signal=${fmt(ci.trend.macd.signal)}, hist=${fmt(ci.trend.macd.histogram)})`)
    lines.push(`Momentum:    RSI=${fmt(ci.momentum.rsi, 1)}  Stochastic %K=${fmt(ci.momentum.stochastic.k, 1)} %D=${fmt(ci.momentum.stochastic.d, 1)}`)
    lines.push(`Volatility:  Bollinger [$${fmt(ci.volatility.bollingerLower)} / $${fmt(ci.volatility.bollingerMiddle)} / $${fmt(ci.volatility.bollingerUpper)}]  ATR=$${fmt(ci.volatility.atr)}  HistVol=${fmt(ci.volatility.historicalVolatility * 100, 1)}%`)
    lines.push(`Volume:      OBV=${ci.volume.obv > 0 ? '+' : ''}${(ci.volume.obv / 1e6).toFixed(1)}M`)
    lines.push(`Risk:        Beta=${fmt(ci.risk.beta)}  MaxDrawdown=-${fmt(ci.risk.maxDrawdown * 100, 1)}%  VaR95=-${fmt(ci.risk.var95 * 100, 2)}%`)
    lines.push(`Fundamentals: P/E=${fmt(ci.fundamentals.pe)}  P/B=${fmt(ci.fundamentals.pb)}  DivYield=${ci.fundamentals.dividendYield != null ? fmt(ci.fundamentals.dividendYield * 100, 2) + '%' : 'N/A'}  EPS=$${fmt(ci.fundamentals.eps)}`)

    return lines.join('\n')
  }

  /** Serialize rawData entries from the report into a readable string for the LLM */
  protected formatRawData(report: TradingReport): string {
    if (report.rawData.length === 0) return ''
    return report.rawData
      .map((r) => {
        const header = `--- ${r.type.toUpperCase()} (${r.ticker} / ${r.market}, fetched ${r.fetchedAt.toISOString()}) ---`
        const payload = this.summarizeDataEntry(r.type, r.data)
        return `${header}\n${payload}`
      })
      .join('\n\n')
  }

  /**
   * Produce a token-efficient summary of a raw data entry.
   * OHLCV / technicals are already captured via computedIndicators,
   * so we only include a compact tail of recent bars.
   */
  private summarizeDataEntry(type: DataType, data: unknown): string {
    if (type === 'ohlcv' || type === 'technicals') {
      const bars = this.extractBars(data)
      if (bars.length === 0) return '(no bars)'
      const recent = bars.slice(-10) // last 10 trading days
      const header = `${bars.length} bars total, showing last ${recent.length}:`
      const rows = recent.map((b: Record<string, unknown>) =>
        `  ${String(b.date ?? '').slice(0, 10)} O=${Number(b.open ?? b.Open).toFixed(2)} H=${Number(b.high ?? b.High).toFixed(2)} L=${Number(b.low ?? b.Low).toFixed(2)} C=${Number(b.close ?? b.Close ?? b.adjClose).toFixed(2)} V=${Number(b.volume ?? b.Volume)}`
      )
      return `${header}\n${rows.join('\n')}`
    }
    // For fundamentals/news keep full data but compact (no pretty-print)
    try {
      return JSON.stringify(data)
    } catch {
      return String(data)
    }
  }

  /** Extract bar array from various OHLCV data shapes */
  private extractBars(data: unknown): Record<string, unknown>[] {
    return normalizeOhlcv(data) as unknown as Record<string, unknown>[]
  }

  protected async retrieveContext(report: TradingReport): Promise<string> {
    if (!this.vectorStore || !this.embedder) return ''
    const query = this.buildQuery(report)
    const embedding = await this.embedder.embed(query)
    const rawMarketDocs = await this.vectorStore.search(embedding, this.topK + 5, {
      must: [{ ticker: report.ticker }],
    })
    const marketDocs = rawMarketDocs
      .filter((doc) => doc.metadata?.['type'] !== 'lesson')
      .slice(0, this.topK)
    const lessonDocs = await this.vectorStore.search(embedding, 3, {
      must: [{ ticker: report.ticker }, { type: 'lesson' }],
    })

    const marketContext = marketDocs.map((doc) => doc.content).join('\n\n')
    const lessonContext = lessonDocs.map((doc) => doc.content).join('\n\n')

    if (!lessonContext) return marketContext
    if (!marketContext) return `=== LESSONS FROM PAST ANALYSIS ===\n${lessonContext}`
    return `${marketContext}\n\n=== LESSONS FROM PAST ANALYSIS ===\n${lessonContext}`
  }

  protected parseFinding(response: string): Finding {
    try {
      const parsed = parseJson<Partial<Finding>>(response)
      const rawStance = parsed.stance
      const validStances = ['bull', 'bear', 'neutral'] as const
      const stance: Finding['stance'] = validStances.includes(rawStance as Finding['stance'])
        ? (rawStance as Finding['stance'])
        : 'neutral'
      const rawConfidence = parsed.confidence ?? 0.5
      const confidence = Math.min(1, Math.max(0, rawConfidence))
      return {
        agentName: this.name,
        stance,
        evidence: parsed.evidence ?? [],
        confidence,
        sentiment: parsed.sentiment,
        fundamentalScore: parsed.fundamentalScore,
        keyMetrics: parsed.keyMetrics,
      }
    } catch {
      return {
        agentName: this.name,
        stance: 'neutral',
        evidence: [`${this.name} was unable to parse LLM response`],
        confidence: 0,
      }
    }
  }

  protected abstract buildQuery(report: TradingReport): string
  protected abstract buildSystemPrompt(report: TradingReport, context: string, rawDataContext: string, indicators: string): string
}
