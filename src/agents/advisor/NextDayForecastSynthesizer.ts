import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { ComputedIndicators, Decision, Market, ResearchThesis, RiskAssessment, RiskVerdict } from '../base/types.js'
import { parseJson } from '../../utils/parseJson.js'
import type { AbstainForecast, BaselineStrength, ForecastDirection, MarketTrend, NextDayForecast, NextDayForecastSuccess } from './types.js'
import { computeSignalAlignment, type SignalAlignment } from './SignalAlignmentScorer.js'
import type { TickerAccuracyProvider, TickerAccuracyStats } from './TickerAccuracyProvider.js'
import { createLogger } from '../../utils/logger.js'
import { getErrorMessage } from '../../utils/errors.js'

const log = createLogger('forecast-synthesizer')

type SynthesizeInput = {
  ticker: string
  market: Market
  targetSession: Date
  baselineAction: Decision['action']
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
}

type RawForecast = {
  predictedDirection?: unknown
  targetPrice?: unknown
  confidence?: unknown
  reasoning?: unknown
  changeFromBaseline?: unknown
}

type NextDayForecastSynthesizerDeps = {
  llm: ILLMProvider
  accuracyProvider?: Pick<TickerAccuracyProvider, 'getStats'>
}

const CLAMP_FLEX = 0.03

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeDirection(value: unknown): { value: ForecastDirection; valid: boolean } {
  if (value === 'up' || value === 'down' || value === 'flat') return { value, valid: true }
  return { value: 'flat', valid: false }
}

function normalizeConfidence(value: unknown): { value: number; valid: boolean } {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) return { value, valid: true }
    if (Number.isInteger(value) && value > 1 && value <= 100) return { value: value / 100, valid: true }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const hasPercentSuffix = trimmed.endsWith('%')
    const numericText = hasPercentSuffix ? trimmed.slice(0, -1).trim() : trimmed
    const parsed = Number(numericText)
    if (Number.isFinite(parsed)) {
      if (parsed >= 0 && parsed <= 1) return { value: parsed, valid: true }
      if (hasPercentSuffix && parsed > 1 && parsed <= 100) return { value: parsed / 100, valid: true }
      if (/^\d+(?:\.0+)?$/.test(numericText) && parsed > 1 && parsed <= 100) return { value: parsed / 100, valid: true }
    }
  }
  return { value: 0, valid: false }
}

function normalizeTargetPrice(
  value: unknown,
  fallback: number,
  direction: ForecastDirection,
  targetRange?: readonly [number, number],
): number {
  if (direction === 'flat') return fallback
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  if (targetRange) {
    const [low, high] = targetRange
    const inDirectionalRange = direction === 'up'
      ? parsed >= fallback && parsed <= high
      : parsed >= low && parsed <= fallback
    if (inDirectionalRange) return Math.round(parsed * 100) / 100
  }
  const deviation = Math.abs(parsed - fallback) / fallback
  const directionalMatch = direction === 'up' ? parsed >= fallback : parsed <= fallback
  return deviation <= 0.02 && directionalMatch ? Math.round(parsed * 100) / 100 : fallback
}

const BAND_RANGES: Record<SignalAlignment['suggestedBand'], readonly [number, number]> = {
  very_low: [0.15, 0.29],
  low: [0.30, 0.49],
  moderate: [0.50, 0.69],
  high: [0.70, 0.85],
}

function clampToAlignmentBand(confidence: number, alignment: SignalAlignment): number {
  const [bandMin, bandMax] = BAND_RANGES[alignment.suggestedBand]
  const flexMin = Math.max(0.15, bandMin - CLAMP_FLEX)
  const flexMax = Math.min(0.88, bandMax + CLAMP_FLEX)
  return Math.max(flexMin, Math.min(flexMax, confidence))
}

function normalizeStrength(value: unknown): BaselineStrength {
  return value === 'strengthened' || value === 'weakened' || value === 'reversed' ? value : 'unchanged'
}

function normalizeReasoning(value: unknown): string {
  if (typeof value !== 'string') return 'Forecast synthesizer could not produce a detailed rationale.'
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : 'Forecast synthesizer could not produce a detailed rationale.'
}

function formatIndicators(ind: ComputedIndicators, anchorPrice: number): string {
  const priceVsSma50 = ((anchorPrice - ind.trend.sma50) / ind.trend.sma50 * 100).toFixed(2)
  const priceVsSma200 = ((anchorPrice - ind.trend.sma200) / ind.trend.sma200 * 100).toFixed(2)
  const bbPosition = ind.volatility.bollingerUpper !== ind.volatility.bollingerLower
    ? ((anchorPrice - ind.volatility.bollingerLower) / (ind.volatility.bollingerUpper - ind.volatility.bollingerLower) * 100).toFixed(0)
    : '50'
  return [
    '--- Trend ---',
    `SMA50: ${ind.trend.sma50.toFixed(2)} (price ${priceVsSma50}% vs SMA50)`,
    `SMA200: ${ind.trend.sma200.toFixed(2)} (price ${priceVsSma200}% vs SMA200)`,
    `MACD: line=${ind.trend.macd.line.toFixed(4)}, signal=${ind.trend.macd.signal.toFixed(4)}, hist=${ind.trend.macd.histogram.toFixed(4)}`,
    '--- Momentum ---',
    `RSI: ${ind.momentum.rsi.toFixed(1)}`,
    `Stochastic: %K=${ind.momentum.stochastic.k.toFixed(1)}, %D=${ind.momentum.stochastic.d.toFixed(1)}`,
    '--- Volatility ---',
    `Bollinger: lower=${ind.volatility.bollingerLower.toFixed(2)}, mid=${ind.volatility.bollingerMiddle.toFixed(2)}, upper=${ind.volatility.bollingerUpper.toFixed(2)} (price at ${bbPosition}% band)`,
    `ATR: ${ind.volatility.atr.toFixed(2)}`,
    `Historical Vol: ${(ind.volatility.historicalVolatility * 100).toFixed(1)}%`,
    '--- Risk ---',
    `Beta: ${ind.risk.beta.toFixed(2)}, Max Drawdown: ${(ind.risk.maxDrawdown * 100).toFixed(1)}%, VaR95: ${(ind.risk.var95 * 100).toFixed(2)}%`,
  ].join('\n')
}

function formatMarketRegime(trends: readonly MarketTrend[]): string {
  if (trends.length === 0) return 'No market index data available.'
  return trends
    .map((t) => `${t.name} (${t.ticker}): ${t.direction}, ${t.changePercent >= 0 ? '+' : ''}${t.changePercent.toFixed(2)}%, RSI=${t.rsi.toFixed(0)}, MACD hist=${t.macdHistogram > 0 ? '+' : ''}${t.macdHistogram.toFixed(3)}`)
    .join('\n')
}

function formatBaselineThesis(thesis?: ResearchThesis): string {
  if (!thesis) return 'No baseline thesis available.'
  return [
    `Stance: ${thesis.stance} (confidence: ${(thesis.confidence * 100).toFixed(0)}%, horizon: ${thesis.timeHorizon})`,
    `Summary: ${thesis.summary}`,
    `Key drivers: ${thesis.keyDrivers.join('; ')}`,
    `Key risks: ${thesis.keyRisks.join('; ')}`,
    `Invalidation: ${thesis.invalidationConditions.join('; ')}`,
  ].join('\n')
}

function formatRiskContext(assessment?: RiskAssessment, verdict?: RiskVerdict): string {
  const parts: string[] = []
  if (assessment) {
    parts.push(`Risk level: ${assessment.riskLevel}, volatility: ${(assessment.metrics.volatility * 100).toFixed(1)}%, beta: ${assessment.metrics.beta.toFixed(2)}, max DD: ${(assessment.metrics.maxDrawdown * 100).toFixed(1)}%`)
    if (assessment.stopLoss != null) parts.push(`Stop loss: $${assessment.stopLoss}, Take profit: $${assessment.takeProfit ?? 'N/A'}`)
  }
  if (verdict) {
    parts.push(`Risk verdict: ${verdict.approved ? 'APPROVED' : 'BLOCKED'} — ${verdict.summary}`)
    if (verdict.blockers.length > 0) parts.push(`Blockers: ${verdict.blockers.join('; ')}`)
  }
  return parts.length > 0 ? parts.join('\n') : 'No risk assessment available.'
}

function formatSignalAlignment(alignment: SignalAlignment): string {
  return [
    `Composite score: ${(alignment.score * 100).toFixed(0)}% → suggested band: ${alignment.suggestedBand.toUpperCase()}`,
    `Target price range (ATR-based): $${alignment.targetPriceRange[0].toFixed(2)} – $${alignment.targetPriceRange[1].toFixed(2)}`,
    `Support: $${alignment.support.toFixed(2)} | Resistance: $${alignment.resistance.toFixed(2)}`,
    '',
    'Signal breakdown:',
    ...alignment.breakdown.map((line) => `  • ${line}`),
  ].join('\n')
}

function formatPastPerformance(stats: TickerAccuracyStats, ticker: string): string {
  const lines: string[] = [
    `=== PAST PERFORMANCE (last ${stats.sampleSize} scored forecasts for ${ticker}) ===`,
    `Directional hit rate: ${(stats.directionalHitRate * 100).toFixed(0)}% (n=${stats.sampleSize})`,
    'Calibration by confidence bucket:',
  ]
  const buckets: Array<[string, typeof stats.calibrationByBucket.high]> = [
    ['HIGH     ', stats.calibrationByBucket.high],
    ['MODERATE ', stats.calibrationByBucket.moderate],
    ['LOW      ', stats.calibrationByBucket.low],
  ]
  for (const [label, b] of buckets) {
    if (b === null) continue
    const gap = b.promised - b.actual
    const flag = Math.abs(gap) >= 0.15
      ? (gap > 0 ? '  ← overconfident' : '  ← underconfident')
      : ''
    lines.push(`  ${label} (n=${b.n}): promised ${(b.promised * 100).toFixed(0)}%, actual ${(b.actual * 100).toFixed(0)}%${flag}`)
  }
  if (stats.targetBandHitRate !== null) {
    lines.push(`Target-band hit rate: ${(stats.targetBandHitRate * 100).toFixed(0)}%`)
  }
  lines.push('')
  lines.push('You MUST acknowledge these stats in your reasoning. If a bucket shows systematic')
  lines.push('miscalibration (|promised − actual| ≥ 15%), adjust your confidence accordingly.')
  return lines.join('\n')
}

function buildSystemPrompt(
  input: SynthesizeInput,
  alignment: SignalAlignment,
  accuracyStats: TickerAccuracyStats | null,
): string {
  const lines = [
    `You are an expert short-term market forecaster. Predict the NEXT TRADING SESSION direction for ${input.ticker} (${input.market}).`,
    '',
    '=== PRE-COMPUTED SIGNAL ALIGNMENT ===',
    formatSignalAlignment(alignment),
    '',
    '=== MARKET REGIME ===',
    formatMarketRegime(input.marketTrends),
    '',
    '=== PRICE ACTION ===',
    `Current live anchor price: $${input.latestClose.toFixed(2)}`,
    `Latest completed daily close: $${input.previousClose.toFixed(2)}`,
    `Move vs latest close: ${input.changePercent >= 0 ? '+' : ''}${input.changePercent.toFixed(2)}%`,
    '',
    '=== FRESH TECHNICAL INDICATORS ===',
    formatIndicators(input.indicators, input.latestClose),
    '',
    '=== BASELINE ANALYSIS ===',
    `Action: ${input.baselineAction}`,
    `Reference price: ${input.baselineReferencePrice != null ? `$${input.baselineReferencePrice.toFixed(2)}` : 'N/A'}`,
    `Summary: ${input.baselineSummary}`,
    '',
    '=== BASELINE RESEARCH THESIS ===',
    formatBaselineThesis(input.baselineThesis),
    '',
    '=== RISK CONTEXT ===',
    formatRiskContext(input.baselineRiskAssessment, input.baselineRiskVerdict),
    '',
    '=== RECENT NEWS ===',
    input.newsItems.length > 0 ? input.newsItems.join('\n') : 'No recent news.',
    '',
    '=== CONFIDENCE CALIBRATION (MANDATORY) ===',
    `The pre-computed signal alignment score for ${input.ticker} is ${(alignment.score * 100).toFixed(0)}% (band: ${alignment.suggestedBand.toUpperCase()}).`,
    'You MUST use this as your starting anchor. You may adjust ±3% based on news and qualitative factors, but you MUST justify any adjustment.',
    '',
    'Band mapping (your confidence MUST fall within this band unless you explain why):',
    '  HIGH (0.70-0.85): signal score ≥ 70% — all signals align',
    '  MODERATE (0.50-0.69): signal score 50-69% — most signals align',
    '  LOW (0.30-0.49): signal score 30-49% — mixed or contradictory signals',
    '  VERY LOW (0.15-0.29): signal score < 30% — use "flat" direction',
    '',
    'NEVER assign confidence > 0.88 for a next-day forecast.',
  ]

  if (accuracyStats) {
    lines.push('', formatPastPerformance(accuracyStats, input.ticker))
  }

  lines.push(
    '',
    '=== TARGET PRICE RULES ===',
    `The ATR-based 1-day target range is $${alignment.targetPriceRange[0].toFixed(2)} – $${alignment.targetPriceRange[1].toFixed(2)}.`,
    `Support: $${alignment.support.toFixed(2)} | Resistance: $${alignment.resistance.toFixed(2)}`,
    'Set targetPrice to your predicted closing price for the next session.',
    '  - If direction is "up": choose a price between the current live anchor price and the upper target range',
    '  - If direction is "down": choose a price between the lower target range and the current live anchor price',
    '  - If direction is "flat": use the current live anchor price',
    'The price MUST be within the ATR-based target range.',
    '',
    '=== DIVERGENCE RULES ===',
    'If the fresh technicals/news CONTRADICT the baseline thesis:',
    '  - Set changeFromBaseline to "weakened" or "reversed"',
    '  - Reduce confidence by at least 0.10 from what you would otherwise assign',
    '  - Explain the divergence explicitly in reasoning',
    '',
    'Return ONLY JSON:',
    '{',
    '  "predictedDirection": "up" | "down" | "flat",',
    `  "targetPrice": number, // predicted next-session close, within [$${alignment.targetPriceRange[0].toFixed(2)}, $${alignment.targetPriceRange[1].toFixed(2)}]`,
    `  "confidence": number, // decimal 0-1, anchored on ${(alignment.score * 100).toFixed(0)}% signal score`,
    '  "reasoning": string, // cite specific indicators and explain any deviation from the signal alignment score',
    '  "changeFromBaseline": "strengthened" | "weakened" | "reversed" | "unchanged"',
    '}',
  )
  return lines.join('\n')
}

type ParsedForecast = {
  direction: ForecastDirection
  confidence: number
  raw: RawForecast
}

function parseResponse(response: string): ParsedForecast | null {
  let parsed: unknown
  try {
    parsed = parseJson<unknown>(response)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const raw = parsed as RawForecast
  const direction = normalizeDirection(raw.predictedDirection)
  const confidence = normalizeConfidence(raw.confidence)
  if (!direction.valid || !confidence.valid) return null
  return { direction: direction.value, confidence: confidence.value, raw }
}

async function loadAccuracyStats(
  deps: NextDayForecastSynthesizerDeps,
  input: SynthesizeInput,
): Promise<TickerAccuracyStats | null> {
  if (!deps.accuracyProvider) return null
  try {
    return await deps.accuracyProvider.getStats(input.ticker, input.market)
  } catch (err) {
    log.warn({ ticker: input.ticker, error: getErrorMessage(err) }, 'Accuracy provider failed')
    return null
  }
}

function buildAbstain(input: SynthesizeInput): AbstainForecast {
  return {
    predictedDirection: 'abstain',
    abstainReason: 'malformed-llm-output',
    referencePrice: input.latestClose,
    targetSession: input.targetSession.toISOString().slice(0, 10),
    baselineAction: input.baselineAction,
    baselineReferencePrice: input.baselineReferencePrice,
  }
}

function buildSuccess(
  input: SynthesizeInput,
  alignment: SignalAlignment,
  parsed: ParsedForecast,
): NextDayForecastSuccess {
  const confidence = clampToAlignmentBand(parsed.confidence, alignment)
  return {
    predictedDirection: parsed.direction,
    referencePrice: input.latestClose,
    targetPrice: normalizeTargetPrice(parsed.raw.targetPrice, input.latestClose, parsed.direction, alignment.targetPriceRange),
    targetSession: input.targetSession.toISOString().slice(0, 10),
    confidence,
    reasoning: normalizeReasoning(parsed.raw.reasoning),
    baselineAction: input.baselineAction,
    baselineReferencePrice: input.baselineReferencePrice,
    changeFromBaseline: normalizeStrength(parsed.raw.changeFromBaseline),
    atrRange: [alignment.targetPriceRange[0], alignment.targetPriceRange[1]] as const,
  }
}

export class NextDayForecastSynthesizer {
  constructor(private readonly deps: NextDayForecastSynthesizerDeps) {}

  async synthesize(input: SynthesizeInput): Promise<NextDayForecast> {
    const alignment = computeSignalAlignment({
      latestClose: input.latestClose,
      previousClose: input.previousClose,
      changePercent: input.changePercent,
      indicators: input.indicators,
      baselineAction: input.baselineAction,
      baselineThesis: input.baselineThesis,
      baselineRiskVerdict: input.baselineRiskVerdict,
      marketTrends: input.marketTrends,
    })
    const accuracyStats = await loadAccuracyStats(this.deps, input)
    const systemPrompt = buildSystemPrompt(input, alignment, accuracyStats)

    const first = await this.deps.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Forecast the next trading session for ${input.ticker}. JSON only.` },
    ])
    const firstParsed = parseResponse(first)
    if (firstParsed) return buildSuccess(input, alignment, firstParsed)

    log.warn({ ticker: input.ticker }, 'First forecast parse failed; retrying')
    const retry = await this.deps.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `JSON ONLY. No prose. Start with '{'. Forecast the next trading session for ${input.ticker}.` },
    ])
    const retryParsed = parseResponse(retry)
    if (retryParsed) return buildSuccess(input, alignment, retryParsed)

    log.error({ ticker: input.ticker }, 'Forecast abstained after malformed retry')
    return buildAbstain(input)
  }
}
