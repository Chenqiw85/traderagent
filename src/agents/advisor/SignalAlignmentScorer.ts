// src/agents/advisor/SignalAlignmentScorer.ts
//
// Pre-computes a quantitative signal-alignment score from technical indicators,
// baseline thesis, and market regime.  The score anchors the LLM so that each
// ticker gets a differentiated confidence instead of a uniform default.

import type { ComputedIndicators, Decision, ResearchThesis, RiskVerdict } from '../base/types.js'
import type { MarketTrend } from './types.js'

export type SignalAlignment = {
  /** 0-1 composite score.  Higher = more signals agree on the predicted direction. */
  readonly score: number
  /** Suggested confidence band based on the score. */
  readonly suggestedBand: 'very_low' | 'low' | 'moderate' | 'high'
  /** Human-readable breakdown of what contributed to the score. */
  readonly breakdown: readonly string[]
  /** ATR-based 1-day target price range [low, high] around latestClose. */
  readonly targetPriceRange: readonly [number, number]
  /** Key support level derived from technicals. */
  readonly support: number
  /** Key resistance level derived from technicals. */
  readonly resistance: number
}

type ScorerInput = {
  readonly latestClose: number
  readonly previousClose: number
  readonly changePercent: number
  readonly indicators: ComputedIndicators
  readonly baselineAction: Decision['action']
  readonly baselineThesis?: ResearchThesis
  readonly baselineRiskVerdict?: RiskVerdict
  readonly marketTrends: readonly MarketTrend[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Returns +1 (bullish), 0 (neutral), or -1 (bearish) for the baseline action.
 */
function baselineDirectionSign(action: Decision['action']): number {
  if (action === 'BUY' || action === 'OVERWEIGHT') return 1
  if (action === 'SELL' || action === 'UNDERWEIGHT') return -1
  return 0
}

export function computeSignalAlignment(input: ScorerInput): SignalAlignment {
  const { indicators: ind, latestClose } = input
  const breakdown: string[] = []

  // --- individual signal scores (-1 to +1 each) ---

  // 1. Trend: price vs SMA50
  const sma50Signal = latestClose > ind.trend.sma50 ? 1 : latestClose < ind.trend.sma50 ? -1 : 0
  breakdown.push(`SMA50: price ${sma50Signal > 0 ? 'above' : sma50Signal < 0 ? 'below' : 'at'} (${sma50Signal > 0 ? '+' : ''}${sma50Signal})`)

  // 2. Trend: price vs SMA200
  const sma200Signal = latestClose > ind.trend.sma200 ? 1 : latestClose < ind.trend.sma200 ? -1 : 0
  breakdown.push(`SMA200: price ${sma200Signal > 0 ? 'above' : sma200Signal < 0 ? 'below' : 'at'} (${sma200Signal > 0 ? '+' : ''}${sma200Signal})`)

  // 3. MACD histogram direction
  const macdSignal = ind.trend.macd.histogram > 0.001 ? 1 : ind.trend.macd.histogram < -0.001 ? -1 : 0
  breakdown.push(`MACD hist: ${macdSignal > 0 ? 'bullish' : macdSignal < 0 ? 'bearish' : 'neutral'} (${macdSignal > 0 ? '+' : ''}${macdSignal})`)

  // 4. RSI zone — extreme values count against directionality
  let rsiSignal: number
  if (ind.momentum.rsi > 70) {
    rsiSignal = -0.5 // overbought → bearish lean
    breakdown.push(`RSI ${ind.momentum.rsi.toFixed(0)}: overbought (-0.5)`)
  } else if (ind.momentum.rsi < 30) {
    rsiSignal = 0.5 // oversold → bullish lean
    breakdown.push(`RSI ${ind.momentum.rsi.toFixed(0)}: oversold (+0.5)`)
  } else if (ind.momentum.rsi > 55) {
    rsiSignal = 0.5
    breakdown.push(`RSI ${ind.momentum.rsi.toFixed(0)}: bullish zone (+0.5)`)
  } else if (ind.momentum.rsi < 45) {
    rsiSignal = -0.5
    breakdown.push(`RSI ${ind.momentum.rsi.toFixed(0)}: bearish zone (-0.5)`)
  } else {
    rsiSignal = 0
    breakdown.push(`RSI ${ind.momentum.rsi.toFixed(0)}: neutral (0)`)
  }

  // 5. Stochastic
  const stochSignal = ind.momentum.stochastic.k > ind.momentum.stochastic.d ? 0.5 : ind.momentum.stochastic.k < ind.momentum.stochastic.d ? -0.5 : 0
  breakdown.push(`Stoch %K vs %D: ${stochSignal > 0 ? 'bullish' : stochSignal < 0 ? 'bearish' : 'neutral'} (${stochSignal > 0 ? '+' : ''}${stochSignal})`)

  // 6. Bollinger band position — price near extremes implies reversal risk
  const bbRange = ind.volatility.bollingerUpper - ind.volatility.bollingerLower
  const bbPosition = bbRange > 0 ? (latestClose - ind.volatility.bollingerLower) / bbRange : 0.5
  let bbSignal: number
  if (bbPosition > 0.9) {
    bbSignal = -0.5
    breakdown.push(`BB position ${(bbPosition * 100).toFixed(0)}%: near upper band, reversal risk (-0.5)`)
  } else if (bbPosition < 0.1) {
    bbSignal = 0.5
    breakdown.push(`BB position ${(bbPosition * 100).toFixed(0)}%: near lower band, bounce potential (+0.5)`)
  } else {
    bbSignal = 0
    breakdown.push(`BB position ${(bbPosition * 100).toFixed(0)}%: mid-band (0)`)
  }

  // 7. Baseline thesis alignment
  const baselineSign = baselineDirectionSign(input.baselineAction)
  breakdown.push(`Baseline: ${input.baselineAction} (sign=${baselineSign > 0 ? '+' : ''}${baselineSign})`)

  // 8. Market regime — average direction of market indices
  let marketRegimeSignal = 0
  if (input.marketTrends.length > 0) {
    const regimeScore = input.marketTrends.reduce((sum, t) => {
      if (t.direction === 'bullish') return sum + 1
      if (t.direction === 'bearish') return sum - 1
      return sum
    }, 0) / input.marketTrends.length
    marketRegimeSignal = clamp(regimeScore, -1, 1)
    breakdown.push(`Market regime: ${marketRegimeSignal > 0.3 ? 'bullish' : marketRegimeSignal < -0.3 ? 'bearish' : 'mixed'} (${marketRegimeSignal > 0 ? '+' : ''}${marketRegimeSignal.toFixed(2)})`)
  }

  // 9. Risk verdict
  let riskPenalty = 0
  if (input.baselineRiskVerdict) {
    if (!input.baselineRiskVerdict.approved) {
      riskPenalty = -0.15
      breakdown.push(`Risk verdict: BLOCKED (-0.15)`)
    } else if (input.baselineRiskVerdict.blockers.length > 0) {
      riskPenalty = -0.05
      breakdown.push(`Risk verdict: approved with caveats (-0.05)`)
    }
  }

  // 10. Volatility penalty — high ATR relative to price reduces confidence
  const atrPercent = (ind.volatility.atr / latestClose) * 100
  let volPenalty = 0
  if (atrPercent > 3) {
    volPenalty = -0.15
    breakdown.push(`Volatility: ATR ${atrPercent.toFixed(1)}% of price, very high (-0.15)`)
  } else if (atrPercent > 2) {
    volPenalty = -0.08
    breakdown.push(`Volatility: ATR ${atrPercent.toFixed(1)}% of price, high (-0.08)`)
  } else {
    breakdown.push(`Volatility: ATR ${atrPercent.toFixed(1)}% of price, normal (0)`)
  }

  // --- Compute raw directional score ---
  // Weighted sum: trend signals (SMA, MACD) get more weight
  const signals = [
    { value: sma50Signal, weight: 1.5 },
    { value: sma200Signal, weight: 1.0 },
    { value: macdSignal, weight: 1.5 },
    { value: rsiSignal, weight: 1.0 },
    { value: stochSignal, weight: 0.5 },
    { value: bbSignal, weight: 0.5 },
    { value: baselineSign, weight: 2.0 },
    { value: marketRegimeSignal, weight: 1.0 },
  ]
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0)
  const rawDirectional = signals.reduce((sum, s) => sum + s.value * s.weight, 0) / totalWeight

  // Agreement = how much signals point in the same direction (0 = total disagreement, 1 = total agreement)
  const directionalCoverage = signals.reduce((sum, s) => sum + Math.abs(s.value) * s.weight, 0) / totalWeight
  const dominantDirection = rawDirectional > 0.05 ? 1 : rawDirectional < -0.05 ? -1 : 0
  const agreement = dominantDirection === 0
    ? 0
    : signals.reduce((sum, s) => {
      const alignedMagnitude = (s.value * dominantDirection) > 0 ? Math.abs(s.value) : 0
      return sum + alignedMagnitude * s.weight
    }, 0) / totalWeight

  // Final composite: agreement (0-1) adjusted by penalties
  const rawScore = clamp(agreement * directionalCoverage + riskPenalty + volPenalty, 0, 1)

  // Map to confidence band
  const suggestedBand: SignalAlignment['suggestedBand'] =
    rawScore >= 0.70 ? 'high'
      : rawScore >= 0.50 ? 'moderate'
        : rawScore >= 0.30 ? 'low'
          : 'very_low'

  // --- Target price range from ATR ---
  const atrMultiplier = 0.8 // ~1 day expected move
  const targetLow = latestClose - ind.volatility.atr * atrMultiplier
  const targetHigh = latestClose + ind.volatility.atr * atrMultiplier

  // --- Support and resistance from technical levels ---
  const support = Math.min(ind.volatility.bollingerLower, ind.trend.sma50)
  const resistance = Math.max(ind.volatility.bollingerUpper, ind.trend.sma50)

  return {
    score: Math.round(rawScore * 100) / 100,
    suggestedBand,
    breakdown,
    targetPriceRange: [Math.round(targetLow * 100) / 100, Math.round(targetHigh * 100) / 100],
    support: Math.round(support * 100) / 100,
    resistance: Math.round(resistance * 100) / 100,
  }
}
