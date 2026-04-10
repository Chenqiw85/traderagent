// src/agents/trader/TradePlanner.ts

import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, ActionTier, TraderProposal, TradingReport } from '../base/types.js'
import { ACTION_TIERS } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
import { normalizeOhlcv } from '../../utils/normalizeOhlcv.js'
import { formatLiveMarketContextLines } from '../../utils/liveMarketSnapshot.js'
import { tickerPreservationInstruction } from '../../prompts/tickerPreservation.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('trade-planner')

type TradePlannerConfig = {
  llm: ILLMProvider
}

type RawTraderProposal = {
  action?: unknown
  confidence?: unknown
  summary?: unknown
  entryLogic?: unknown
  whyNow?: unknown
  timeHorizon?: unknown
  referencePrice?: unknown
  positionSizeFraction?: unknown
  stopLoss?: unknown
  takeProfit?: unknown
  invalidationConditions?: unknown
}

const VALID_TIME_HORIZONS = ['short', 'swing', 'position'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return fallback
  return value
}

function normalizeAction(value: unknown): ActionTier {
  return typeof value === 'string' && ACTION_TIERS.includes(value as ActionTier)
    ? (value as ActionTier)
    : 'HOLD'
}

function normalizeTimeHorizon(
  value: unknown,
  fallback: TraderProposal['timeHorizon'],
): TraderProposal['timeHorizon'] {
  return typeof value === 'string' && VALID_TIME_HORIZONS.includes(value as TraderProposal['timeHorizon'])
    ? (value as TraderProposal['timeHorizon'])
    : fallback
}

function normalizeFraction(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined
}

function normalizePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export class TradePlanner implements IAgent {
  readonly name = 'tradePlanner'
  readonly role: AgentRole = 'trader'

  private readonly llm: ILLMProvider

  constructor(config: TradePlannerConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    if (!report.researchThesis) {
      throw new Error('TradePlanner: cannot plan without researchThesis')
    }

    const groundedContext = this.buildGroundedContext(report)
    const prompt = withLanguage(`${tickerPreservationInstruction(report.ticker)}

You are a live trade planner converting a structured research thesis into an executable trade proposal for ${report.ticker}.

Use the research thesis as the primary input, but ground any numeric outputs in the live market context provided below. If the context is insufficient for a number, leave that field null instead of inventing precision.

${groundedContext}

TRADE PLANNING FRAMEWORK:

1. REFERENCE PRICE (required for BUY/SELL/OVERWEIGHT/UNDERWEIGHT):
   - This is the specific price level at which to enter the trade
   - For BUY/OVERWEIGHT: use the nearest support level, current price, or a breakout level
   - For SELL/UNDERWEIGHT: use the nearest resistance level, current price, or a breakdown level
   - Must be grounded in actual data: latest close, SMA, Bollinger band, or recent swing high/low
   - For HOLD actions, set to null

2. ENTRY LOGIC:
   - Define a specific price level or condition for entry (not vague descriptions)
   - Reference technical levels: Bollinger bands, SMA support/resistance, recent high/low
   - Example: "Enter long above $385 (SMA50 reclaim)" NOT "enter on strength"

3. STOP LOSS — use ATR-based methodology:
   - For long trades: entry price minus (1.5 × ATR) to (2 × ATR)
   - For short trades: entry price plus (1.5 × ATR) to (2 × ATR)
   - Also consider key technical levels (below support for longs, above resistance for shorts)
   - If ATR is not available, use recent swing low/high as stop

4. TAKE PROFIT — use risk-reward ratio:
   - Minimum 2:1 reward-to-risk ratio (if risking $10 on stop, target at least $20 profit)
   - Align with technical targets: next resistance/support, Bollinger band extremes
   - For HOLD actions, leave null

5. RISK-REWARD ASSESSMENT:
   - Calculate: reward = |takeProfit - entry| / |entry - stopLoss|
   - If risk-reward < 1.5:1, downgrade confidence or suggest HOLD instead
   - Include this ratio in your summary

6. POSITION SIZING:
   - Base: 2-5% of portfolio for swing trades, 1-2% for short-term
   - Scale by confidence: high confidence = upper range, low = lower range
   - Scale down for high-beta or high-volatility stocks

RULES:
- ALL price levels must come from the market context above — do NOT invent numbers
- If the thesis says HOLD/neutral, reflect that honestly — don't force a directional trade
- invalidationConditions must be specific and measurable (price levels, indicator values)

Respond with ONLY a JSON object matching this schema:
{
  "action": "BUY" | "OVERWEIGHT" | "HOLD" | "UNDERWEIGHT" | "SELL",
  "confidence": <number 0-1>,
  "summary": "<proposal summary including risk-reward ratio>",
  "entryLogic": "<specific entry condition with price level>",
  "whyNow": "<why this setup matters now>",
  "timeHorizon": "short" | "swing" | "position",
  "referencePrice": <number — the specific entry price level, or null for HOLD>,
  "positionSizeFraction": <number or null>,
  "stopLoss": <number or null>,
  "takeProfit": <number or null>,
  "invalidationConditions": ["<measurable condition 1>", "<measurable condition 2>"]
}`)

    let proposal: TraderProposal

    try {
      const response = await this.llm.chat([
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: `Research thesis for ${report.ticker}:\n${JSON.stringify(report.researchThesis, null, 2)}\n\nJSON only.`,
        },
      ])

      const parsed = parseJson<unknown>(response)
      if (!isRecord(parsed)) {
        throw new Error('LLM response must be a JSON object')
      }

      const raw = parsed as RawTraderProposal
      proposal = {
        action: normalizeAction(raw.action),
        confidence: normalizeConfidence(raw.confidence, 0.5),
        summary: normalizeString(raw.summary),
        entryLogic: normalizeString(raw.entryLogic),
        whyNow: normalizeString(raw.whyNow),
        timeHorizon: normalizeTimeHorizon(raw.timeHorizon, report.researchThesis.timeHorizon),
        referencePrice: normalizePositiveNumber(raw.referencePrice),
        positionSizeFraction: normalizeFraction(raw.positionSizeFraction),
        stopLoss: normalizePositiveNumber(raw.stopLoss),
        takeProfit: normalizePositiveNumber(raw.takeProfit),
        invalidationConditions: normalizeStringArray(raw.invalidationConditions),
      }
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : String(err) }, 'Trade planning failed')
      proposal = {
        action: 'HOLD',
        confidence: 0,
        summary: '',
        entryLogic: '',
        whyNow: '',
        timeHorizon: report.researchThesis.timeHorizon,
        invalidationConditions: [],
      }
    }

    const analysisArtifact = {
      stage: 'trade' as const,
      agent: this.name,
      summary: proposal.summary,
      payload: proposal,
    }

    return {
      ...report,
      traderProposal: proposal,
      analysisArtifacts: [...(report.analysisArtifacts ?? []), analysisArtifact],
    }
  }

  private buildGroundedContext(report: TradingReport): string {
    const lines: string[] = ['=== Latest market context ===']
    const indicatorLines = this.formatIndicators(report)
    if (indicatorLines.length > 0) {
      lines.push(...indicatorLines)
    }

    const latestBarLine = this.formatLatestBar(report)
    if (latestBarLine) {
      lines.push(latestBarLine)
    }

    lines.push(...formatLiveMarketContextLines(report))

    const findingsLine = this.formatResearchFindings(report)
    if (findingsLine) {
      lines.push(findingsLine)
    }

    if (lines.length === 1) {
      lines.push('No additional live market context available beyond the thesis.')
    }

    return lines.join('\n')
  }

  private formatIndicators(report: TradingReport): string[] {
    const ci = report.computedIndicators
    if (!ci) return []

    const fmt = (value: number | null, decimals = 2) =>
      value == null || Number.isNaN(value) ? 'N/A' : value.toFixed(decimals)

    return [
      `Indicators: RSI=${fmt(ci.momentum.rsi, 1)} MACD=${fmt(ci.trend.macd.line)} signal=${fmt(ci.trend.macd.signal)} hist=${fmt(ci.trend.macd.histogram)}`,
      `Trend: SMA50=${fmt(ci.trend.sma50)} SMA200=${fmt(ci.trend.sma200)} EMA12=${fmt(ci.trend.ema12)} EMA26=${fmt(ci.trend.ema26)}`,
      `Volatility: ATR=${fmt(ci.volatility.atr)} BollingerMid=${fmt(ci.volatility.bollingerMiddle)} HistVol=${fmt(ci.volatility.historicalVolatility * 100, 1)}%`,
      `Risk: Beta=${fmt(ci.risk.beta)} MaxDrawdown=${fmt(ci.risk.maxDrawdown * 100, 1)}% VaR95=${fmt(ci.risk.var95 * 100, 2)}%`,
    ]
  }

  private formatLatestBar(report: TradingReport): string {
    const latestOhlcv = report.rawData.find((entry) => entry.type === 'ohlcv')
    if (!latestOhlcv) return ''

    const bars = normalizeOhlcv(latestOhlcv.data)
    const latestBar = bars.at(-1)
    if (!latestBar) return ''

    return `Latest bar: date=${latestBar.date ?? 'unknown'} open=${latestBar.open.toFixed(2)} high=${latestBar.high.toFixed(2)} low=${latestBar.low.toFixed(2)} close=${latestBar.close.toFixed(2)} volume=${latestBar.volume}`
  }

  private formatResearchFindings(report: TradingReport): string {
    if (report.researchFindings.length === 0) return ''
    const summaries = report.researchFindings
      .slice(0, 3)
      .map((finding) => `${finding.agentName}/${finding.stance}: ${finding.evidence.slice(0, 2).join('; ') || 'no evidence summary'}`)
    return `Research findings summary: ${summaries.join(' | ')}`
  }
}
