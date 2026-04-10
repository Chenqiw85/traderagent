import type { ScoredDecision } from '../trader/types.js'
import type { CalibratedThresholds } from '../../types/quality.js'
import type { ActionTier } from '../base/types.js'

const MIN_SAMPLE_SIZE = 20

const DEFAULT_THRESHOLDS: CalibratedThresholds['thresholds'] = {
  strongBuy: 6,
  buy: 3,
  hold: [-2, 2] as const,
  sell: -5,
  strongSell: -6,
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  research: 0.25,
  technical: 0.25,
  fundamental: 0.20,
  risk: 0.15,
  proposal: 0.15,
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TIER_RETURN_MAP: Record<ActionTier, [number, number]> = {
  BUY: [0.05, Infinity],
  OVERWEIGHT: [0.02, 0.05],
  HOLD: [-0.02, 0.02],
  UNDERWEIGHT: [-0.05, -0.02],
  SELL: [-Infinity, -0.05],
}

export class ThresholdCalibrator {
  calibrate(decisions: ScoredDecision[]): CalibratedThresholds {
    if (decisions.length < MIN_SAMPLE_SIZE) {
      return {
        calibratedAt: new Date(),
        sampleSize: decisions.length,
        calibrationConfidence: decisions.length / MIN_SAMPLE_SIZE * 0.5,
        thresholds: DEFAULT_THRESHOLDS,
        dimensionWeights: DEFAULT_WEIGHTS,
      }
    }

    const thresholds = this.findOptimalThresholds(decisions)
    const dimensionWeights = this.estimateDimensionWeights(decisions)
    const calibrationConfidence = this.computeCalibrationConfidence(decisions, thresholds)

    return {
      calibratedAt: new Date(),
      sampleSize: decisions.length,
      calibrationConfidence,
      thresholds,
      dimensionWeights,
    }
  }

  private findOptimalThresholds(decisions: ScoredDecision[]): CalibratedThresholds['thresholds'] {
    const byTier = new Map<ActionTier, ScoredDecision[]>()
    for (const d of decisions) {
      const tier = d.breakdown.realizedTier
      const existing = byTier.get(tier) ?? []
      existing.push(d)
      byTier.set(tier, existing)
    }

    const avgScore = (tier: ActionTier): number => {
      const group = byTier.get(tier) ?? []
      if (group.length === 0) return this.defaultForTier(tier)
      return group.reduce((sum, d) => sum + d.compositeScore, 0) / group.length
    }

    const buyAvg = avgScore('BUY')
    const overweightAvg = avgScore('OVERWEIGHT')
    const holdAvg = avgScore('HOLD')
    const underweightAvg = avgScore('UNDERWEIGHT')
    const sellAvg = avgScore('SELL')

    const strongBuy = this.scaleThreshold(buyAvg, 6)
    const buy = this.scaleThreshold((buyAvg + overweightAvg) / 2, 3)
    const holdUpper = this.scaleThreshold((overweightAvg + holdAvg) / 2, 2)
    const holdLower = this.scaleThreshold((holdAvg + underweightAvg) / 2, -2)
    const sell = this.scaleThreshold((underweightAvg + sellAvg) / 2, -3)
    const strongSell = this.scaleThreshold(sellAvg, -6)

    return {
      strongBuy: Math.max(strongBuy, buy + 0.5),
      buy: Math.max(buy, holdUpper + 0.5),
      hold: [Math.min(holdLower, holdUpper - 0.5), holdUpper] as const,
      sell: Math.min(sell, holdLower - 0.5),
      strongSell: Math.min(strongSell, sell - 0.5),
    }
  }

  private scaleThreshold(score: number, defaultVal: number): number {
    const learned = (score - 0.5) * 20
    return learned * 0.7 + defaultVal * 0.3
  }

  private defaultForTier(tier: ActionTier): number {
    const defaults: Record<ActionTier, number> = {
      BUY: 0.8,
      OVERWEIGHT: 0.65,
      HOLD: 0.5,
      UNDERWEIGHT: 0.35,
      SELL: 0.2,
    }
    return defaults[tier]
  }

  private estimateDimensionWeights(decisions: ScoredDecision[]): Record<string, number> {
    const n = decisions.length
    if (n === 0) return DEFAULT_WEIGHTS

    const correlations: Record<string, number> = {
      research: this.correlation(decisions.map((d) => d.breakdown.directionalScore), decisions.map((d) => d.compositeScore)),
      technical: this.correlation(decisions.map((d) => d.breakdown.tierDistanceScore), decisions.map((d) => d.compositeScore)),
      fundamental: this.correlation(decisions.map((d) => d.breakdown.calibrationScore), decisions.map((d) => d.compositeScore)),
      risk: this.correlation(decisions.map((d) => d.breakdown.riskExecutionScore), decisions.map((d) => d.compositeScore)),
      proposal: this.correlation(decisions.map((d) => d.breakdown.holdQualityScore), decisions.map((d) => d.compositeScore)),
    }

    const absCorrs = Object.entries(correlations).map(([k, v]) => [k, Math.abs(v)] as const)
    const total = absCorrs.reduce((sum, [, v]) => sum + v, 0)

    if (total === 0) return DEFAULT_WEIGHTS

    const weights: Record<string, number> = {}
    for (const [k, v] of absCorrs) {
      weights[k] = Math.round((v / total) * 100) / 100
    }

    return weights
  }

  private correlation(xs: number[], ys: number[]): number {
    const n = xs.length
    if (n < 2) return 0

    const xMean = xs.reduce((a, b) => a + b, 0) / n
    const yMean = ys.reduce((a, b) => a + b, 0) / n

    let num = 0
    let denomX = 0
    let denomY = 0

    for (let i = 0; i < n; i++) {
      const dx = xs[i] - xMean
      const dy = ys[i] - yMean
      num += dx * dy
      denomX += dx * dx
      denomY += dy * dy
    }

    const denom = Math.sqrt(denomX * denomY)
    return denom === 0 ? 0 : num / denom
  }

  private computeCalibrationConfidence(decisions: ScoredDecision[], thresholds: CalibratedThresholds['thresholds']): number {
    const sizeConfidence = Math.min(decisions.length / 100, 1)
    const avgScore = decisions.reduce((sum, d) => sum + d.compositeScore, 0) / decisions.length

    return Math.round(sizeConfidence * avgScore * 100) / 100
  }
}
