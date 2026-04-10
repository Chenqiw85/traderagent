// src/agents/trader/CompositeScorer.ts

import { ACTION_DIRECTION, type ActionTier, type Decision } from '../base/types.js'
import { SCORE_WEIGHTS, type ScoreBreakdown } from './types.js'

type ScorerConfig = {
  evaluationDays: number
  holdThreshold?: number
}

type PriceOutcome = {
  actualReturn: number
  closePrices: readonly number[]
}

type ScoreResult = {
  breakdown: ScoreBreakdown
  compositeScore: number
}

const TIER_INDEX: Record<ActionTier, number> = {
  SELL: 0,
  UNDERWEIGHT: 1,
  HOLD: 2,
  OVERWEIGHT: 3,
  BUY: 4,
}

export class CompositeScorer {
  private readonly evaluationDays: number
  private readonly holdThreshold: number

  constructor(config: ScorerConfig) {
    this.evaluationDays = config.evaluationDays
    this.holdThreshold = config.holdThreshold ?? 0.02
  }

  score(decision: Decision, outcome: PriceOutcome): ScoreResult {
    const realizedTier = this.realizedTier(outcome.actualReturn)
    const exactTierHit = decision.action === realizedTier
    const tierDistanceScore = this.scoreTierDistance(decision.action, realizedTier)
    const directionalScore = this.scoreDirectional(decision, outcome)
    const calibrationScore = this.scoreCalibration(decision, outcome)
    const holdQualityScore = this.scoreHoldQuality(decision, outcome)
    const riskExecutionScore = this.scoreRiskExecution(decision, outcome)

    const breakdown: ScoreBreakdown = {
      realizedTier,
      exactTierHit,
      tierDistanceScore,
      directionalScore,
      calibrationScore,
      holdQualityScore,
      riskExecutionScore,
    }

    const compositeScore =
      breakdown.tierDistanceScore * SCORE_WEIGHTS.tierDistance +
      breakdown.directionalScore * SCORE_WEIGHTS.directional +
      breakdown.calibrationScore * SCORE_WEIGHTS.calibration +
      breakdown.holdQualityScore * SCORE_WEIGHTS.holdQuality +
      breakdown.riskExecutionScore * SCORE_WEIGHTS.riskExecution

    return { breakdown, compositeScore }
  }

  private realizedTier(actualReturn: number): ActionTier {
    if (actualReturn >= 0.05) return 'BUY'
    if (actualReturn >= 0.02) return 'OVERWEIGHT'
    if (actualReturn <= -0.05) return 'SELL'
    if (actualReturn <= -0.02) return 'UNDERWEIGHT'
    return 'HOLD'
  }

  private scoreTierDistance(expected: ActionTier, actual: ActionTier): number {
    const distance = Math.abs(TIER_INDEX[expected] - TIER_INDEX[actual])
    return Math.max(0, 1 - distance * 0.25)
  }

  private scoreDirectional(decision: Decision, outcome: PriceOutcome): number {
    const direction = ACTION_DIRECTION[decision.action]
    if (direction === 0) return 0.5 // HOLD
    // For directional actions, score based on alignment with actual return
    const aligned = (direction > 0 && outcome.actualReturn > 0) ||
                    (direction < 0 && outcome.actualReturn < 0)
    if (aligned) return Math.abs(direction) >= 1 ? 1 : 0.75 // BUY/SELL = 1, OVERWEIGHT/UNDERWEIGHT = 0.75
    return Math.abs(direction) >= 1 ? 0 : 0.25 // Wrong direction but mild conviction = 0.25
  }

  private scoreRiskExecution(decision: Decision, outcome: PriceOutcome): number {
    if (decision.stopLoss == null && decision.takeProfit == null) return 0.5
    const direction = ACTION_DIRECTION[decision.action]
    if (direction === 0) return 0.5
    const isBullish = direction > 0
    for (const price of outcome.closePrices) {
      if (decision.takeProfit != null) {
        if (isBullish && price >= decision.takeProfit) return 1
        if (!isBullish && price <= decision.takeProfit) return 1
      }
      if (decision.stopLoss != null) {
        if (isBullish && price <= decision.stopLoss) return 0
        if (!isBullish && price >= decision.stopLoss) return 0
      }
    }
    return 0.5
  }

  private scoreCalibration(decision: Decision, outcome: PriceOutcome): number {
    const realizedTier = this.realizedTier(outcome.actualReturn)
    const direction = ACTION_DIRECTION[decision.action]
    if (direction === 0) {
      const correct = realizedTier === 'HOLD'
      return correct ? decision.confidence : 1 - decision.confidence
    }

    const correct =
      (direction > 0 && (realizedTier === 'BUY' || realizedTier === 'OVERWEIGHT')) ||
      (direction < 0 && (realizedTier === 'UNDERWEIGHT' || realizedTier === 'SELL'))
    return correct ? decision.confidence : 1 - decision.confidence
  }

  private scoreHoldQuality(decision: Decision, outcome: PriceOutcome): number {
    const direction = ACTION_DIRECTION[decision.action]
    if (direction !== 0) return 1 // Non-HOLD actions are not penalized
    const absReturn = Math.abs(outcome.actualReturn)
    return absReturn <= this.holdThreshold ? 1 : 0
  }
}
