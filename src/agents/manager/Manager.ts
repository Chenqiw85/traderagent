// src/agents/manager/Manager.ts
import type { IAgent } from '../base/IAgent.js'
import type {
  ActionTier,
  AgentRole,
  Decision,
  LessonPerspective,
  LessonRetrievalEvent,
  LessonSource,
  TradingReport,
} from '../base/types.js'
import { ACTION_TIERS } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { supportsTextSearch, type Document, type IVectorStore } from '../../rag/IVectorStore.js'
import type { IEmbedder } from '../../rag/IEmbedder.js'
import { buildSetupQuery } from '../../analysis/buildSetupQuery.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
import { tickerPreservationInstruction } from '../../prompts/tickerPreservation.js'
import { formatLiveMarketContextLines } from '../../utils/liveMarketSnapshot.js'
import type { CalibratedThresholds } from '../../types/quality.js'

type ManagerConfig = {
  llm: ILLMProvider
  vectorStore?: IVectorStore
  embedder?: IEmbedder
  calibratedThresholds?: CalibratedThresholds
  calibratedThresholdsLoader?: (
    ticker: string,
    market: TradingReport['market'],
  ) => CalibratedThresholds | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeConfidence(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback
}

function normalizeFraction(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined
}

function normalizePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function normalizeLessonPerspective(value: unknown): LessonPerspective {
  return value === 'bull' || value === 'bear' || value === 'manager' || value === 'shared'
    ? value
    : 'shared'
}

function normalizeLessonSource(value: unknown): LessonSource {
  return value === 'reflection' || value === 'extractor' ? value : 'extractor'
}

export class Manager implements IAgent {
  readonly name = 'manager'
  readonly role: AgentRole = 'manager'

  private llm: ILLMProvider
  private vectorStore?: IVectorStore
  private embedder?: IEmbedder
  private config: ManagerConfig

  constructor(config: ManagerConfig) {
    this.llm = config.llm
    this.vectorStore = config.vectorStore
    this.embedder = config.embedder
    this.config = config
  }

  async run(report: TradingReport): Promise<TradingReport> {
    if (report.researchFindings.length === 0 && !report.researchThesis && !report.traderProposal) {
      throw new Error('Manager: cannot make a decision — no research findings, thesis, or trader proposal available')
    }

    const context = this.buildContext(report)
    const { lessonContext, retrievals } = await this.retrieveLessons(report)
    const fullContext = lessonContext
      ? `${context}\n\n=== LESSONS FROM PAST ANALYSIS ===\n${lessonContext}`
      : context
    const thresholds = this.config.calibratedThresholds
      ?? this.config.calibratedThresholdsLoader?.(report.ticker, report.market)
    const t = thresholds?.thresholds ?? {
      strongBuy: 6, buy: 3, hold: [-2, 2] as const, sell: -5, strongSell: -6,
    }
    const response = await this.llm.chat([
      {
        role: 'system',
        content: withLanguage(`${tickerPreservationInstruction(report.ticker)}

You are a senior portfolio manager making a final trading decision for ${report.ticker}.
${fullContext}

DECISION FRAMEWORK — follow this structured process:

STEP 1: SIGNAL ALIGNMENT CHECK
Score each dimension (strong bearish = -2, bearish = -1, neutral = 0, bullish = +1, strong bullish = +2):
- Research thesis stance and confidence
- Technical trend (price vs SMAs, MACD direction)
- Fundamental valuation (P/E, P/B reasonableness)
- Risk assessment level (low/medium/high)
- Trader proposal direction

STEP 2: ACTION MAPPING (based on net signal score)
- Net score >= ${t.strongBuy}: BUY (strong multi-signal alignment)
- Net score ${t.buy} to ${t.strongBuy - 1}: OVERWEIGHT (mostly bullish)
- Net score ${t.hold[0]} to ${t.hold[1]}: HOLD (mixed or insufficient conviction)
- Net score ${t.sell} to ${t.hold[0] - 1}: UNDERWEIGHT (mostly bearish)
- Net score <= ${t.strongSell}: SELL (strong multi-signal alignment)

STEP 3: RISK GATE
- If risk verdict is NOT approved, you MUST choose HOLD — the risk gate will override any other action to HOLD
- If risk level is HIGH, reduce confidence by 0.15 and position size by half
- If research confidence is below 0.4, default to HOLD regardless of direction

STEP 4: POSITION SIZING RATIONALE
- Base size: 5% for strong conviction, 3% for moderate, 1% for low
- Adjust down for: high volatility, high beta, low confidence, risk concerns
- Adjust up for: low volatility, strong multi-signal alignment, high data quality
- EXPLAIN why you chose the specific position size

STEP 5: CONFIDENCE CALIBRATION
Your confidence should reflect:
- How many independent signals agree (more alignment = higher)
- Quality of underlying data (N/A values = lower)
- Whether risk verdict supports the action (rejection = lower)
- 0.8+ requires: aligned thesis + aligned technicals + acceptable risk + approved by risk team

5-tier action scale:
- BUY: Strong conviction to enter/add a long position
- OVERWEIGHT: Moderately bullish, increase existing position
- HOLD: Neutral, maintain current position
- UNDERWEIGHT: Moderately bearish, reduce existing position
- SELL: Strong conviction to exit/short

Respond with ONLY a JSON object matching this schema:
{
  "action": "BUY" | "OVERWEIGHT" | "HOLD" | "UNDERWEIGHT" | "SELL",
  "confidence": <number 0-1>,
  "reasoning": "<explain: signal scores, which evidence was decisive, why this position size, what would change your mind>",
  "suggestedPositionSize": <number, fraction of portfolio>,
  "stopLoss": <number or null>,
  "takeProfit": <number or null>
}`),
      },
      { role: 'user', content: `Make a final decision for ${report.ticker}. Respond with JSON only.` },
    ])

    const decision = this.applyRiskGate(this.parseDecision(response), report)

    return {
      ...report,
      finalDecision: decision,
      lessonRetrievals: [...(report.lessonRetrievals ?? []), ...retrievals],
      analysisArtifacts: [
        ...(report.analysisArtifacts ?? []),
        {
          stage: 'final',
          agent: this.name,
          summary: decision.reasoning,
          payload: decision,
        },
      ],
    }
  }

  private async retrieveLessons(
    report: TradingReport,
  ): Promise<{ lessonContext: string; retrievals: LessonRetrievalEvent[] }> {
    const query = buildSetupQuery(report)
    if (!this.vectorStore) return { lessonContext: '', retrievals: [] }
    const docs = supportsTextSearch(this.vectorStore)
      ? await this.vectorStore.searchText(query, 3, {
          must: [{ ticker: report.ticker }, { market: report.market }, { type: 'lesson' }],
        })
      : this.embedder
        ? await this.vectorStore.search(await this.embedder.embed(query), 3, {
            must: [{ ticker: report.ticker }, { market: report.market }, { type: 'lesson' }],
          })
        : []

    return {
      lessonContext: docs.map((doc) => doc.content).join('\n\n'),
      retrievals: this.buildLessonRetrievals(docs, report, query),
    }
  }

  private buildContext(report: TradingReport): string {
    const lines: string[] = []
    const liveMarketLines = formatLiveMarketContextLines(report)
    if (liveMarketLines.length > 0) {
      lines.push(...liveMarketLines, '')
    }
    if (report.researchThesis) {
      lines.push('=== Research Thesis ===')
      lines.push(`Stance: ${report.researchThesis.stance} (confidence: ${report.researchThesis.confidence})`)
      lines.push(`Summary: ${report.researchThesis.summary}`)
      if (report.researchThesis.keyDrivers.length > 0) {
        lines.push(`Key drivers: ${report.researchThesis.keyDrivers.join('; ')}`)
      }
      if (report.researchThesis.keyRisks.length > 0) {
        lines.push(`Key risks: ${report.researchThesis.keyRisks.join('; ')}`)
      }
      if (report.researchThesis.invalidationConditions.length > 0) {
        lines.push(`Invalidation conditions: ${report.researchThesis.invalidationConditions.join('; ')}`)
      }
      lines.push(`Time horizon: ${report.researchThesis.timeHorizon}`)
      lines.push('')
    }
    if (report.traderProposal) {
      lines.push('=== Trader Proposal ===')
      lines.push(`Action: ${report.traderProposal.action} (confidence: ${report.traderProposal.confidence})`)
      lines.push(`Summary: ${report.traderProposal.summary}`)
      lines.push(`Entry logic: ${report.traderProposal.entryLogic}`)
      lines.push(`Why now: ${report.traderProposal.whyNow}`)
      lines.push(`Time horizon: ${report.traderProposal.timeHorizon}`)
      if (report.traderProposal.referencePrice !== undefined) {
        lines.push(`Reference price: $${report.traderProposal.referencePrice}`)
      }
      if (report.traderProposal.positionSizeFraction !== undefined) {
        lines.push(`Position size fraction: ${report.traderProposal.positionSizeFraction}`)
      }
      if (report.traderProposal.stopLoss !== undefined) {
        lines.push(`Stop loss: ${report.traderProposal.stopLoss}`)
      }
      if (report.traderProposal.takeProfit !== undefined) {
        lines.push(`Take profit: ${report.traderProposal.takeProfit}`)
      }
      if (report.traderProposal.invalidationConditions.length > 0) {
        lines.push(`Invalidation conditions: ${report.traderProposal.invalidationConditions.join('; ')}`)
      }
      lines.push('')
    }
    if (report.riskVerdict) {
      lines.push('=== Risk Verdict ===')
      lines.push(`Approved: ${report.riskVerdict.approved}`)
      lines.push(`Summary: ${report.riskVerdict.summary}`)
      if (report.riskVerdict.blockers.length > 0) {
        lines.push(`Blockers: ${report.riskVerdict.blockers.join('; ')}`)
      }
      if (report.riskVerdict.requiredAdjustments.length > 0) {
        lines.push(`Required adjustments: ${report.riskVerdict.requiredAdjustments.join('; ')}`)
      }
      lines.push('')
    }
    if (report.researchFindings.length > 0) {
      lines.push('=== Supporting Research Findings ===')
    }
    for (const f of report.researchFindings) {
      lines.push(`${f.agentName}: ${f.stance} (confidence: ${f.confidence})`)
      if (f.evidence.length > 0) lines.push(`  Evidence: ${f.evidence.slice(0, 3).join('; ')}`)
      if (f.sentiment) lines.push(`  Sentiment: ${f.sentiment}`)
      if (f.fundamentalScore !== undefined) lines.push(`  Fundamental score: ${f.fundamentalScore}`)
    }
    if (report.riskAssessment) {
      lines.push(report.researchFindings.length > 0 ? '' : '=== Supporting Risk Assessment ===')
      const ra = report.riskAssessment
      lines.push(`Risk: ${ra.riskLevel} | VaR: ${ra.metrics.VaR} | Volatility: ${ra.metrics.volatility}`)
      if (ra.maxPositionSize !== undefined) lines.push(`Max position: ${ra.maxPositionSize}`)
      if (ra.stopLoss !== undefined) lines.push(`Stop loss: ${ra.stopLoss}`)
      if (ra.takeProfit !== undefined) lines.push(`Take profit: ${ra.takeProfit}`)
    }
    if (report.dataQuality) {
      lines.push('')
      lines.push('=== DATA QUALITY ADVISORY ===')
      lines.push(report.dataQuality.advisory)
      lines.push(`Overall data completeness: ${(report.dataQuality.overall * 100).toFixed(0)}%`)
    }
    return lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n')
  }

  private parseDecision(response: string): Decision {
    try {
      const parsed = parseJson<unknown>(response)
      if (!isRecord(parsed)) {
        throw new Error('Manager decision response must be an object')
      }
      const action: ActionTier = ACTION_TIERS.includes(parsed.action as ActionTier)
        ? (parsed.action as ActionTier)
        : 'HOLD'
      return {
        action,
        confidence: normalizeConfidence(parsed.confidence, 0.5),
        reasoning: typeof parsed.reasoning === 'string'
          ? parsed.reasoning
          : 'Unable to parse manager response',
        suggestedPositionSize: normalizeFraction(parsed.suggestedPositionSize),
        stopLoss: normalizePositiveNumber(parsed.stopLoss),
        takeProfit: normalizePositiveNumber(parsed.takeProfit),
      }
    } catch {
      return {
        action: 'HOLD',
        confidence: 0,
        reasoning: 'Manager was unable to parse LLM response',
      }
    }
  }

  private applyRiskGate(decision: Decision, report: TradingReport): Decision {
    if (!report.riskVerdict || report.riskVerdict.approved || decision.action === 'HOLD') {
      return decision
    }

    const blockers = report.riskVerdict.blockers.length > 0
      ? ` Blockers: ${report.riskVerdict.blockers.join('; ')}.`
      : ''
    const adjustments = report.riskVerdict.requiredAdjustments.length > 0
      ? ` Required adjustments: ${report.riskVerdict.requiredAdjustments.join('; ')}.`
      : ''

    return {
      ...decision,
      action: 'HOLD',
      confidence: Math.min(decision.confidence, 0.35),
      suggestedPositionSize: 0,
      stopLoss: undefined,
      takeProfit: undefined,
      reasoning: `${report.riskVerdict.summary} The risk gate rejected the proposal, so the non-HOLD action was overridden to HOLD.${blockers}${adjustments}`,
    }
  }

  private buildLessonRetrievals(
    docs: Document[],
    report: TradingReport,
    query: string,
  ): LessonRetrievalEvent[] {
    return docs.map((doc, index) => ({
      lessonId: doc.id,
      agent: this.name,
      perspective: normalizeLessonPerspective(doc.metadata?.['perspective']),
      source: normalizeLessonSource(doc.metadata?.['source']),
      ticker: report.ticker,
      market: report.market,
      asOf: report.timestamp,
      query,
      rank: index + 1,
    }))
  }
}
