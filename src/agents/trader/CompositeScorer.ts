// src/agents/trader/CompositeScorer.ts

import { ACTION_DIRECTION, type Decision } from '../base/types.js'
import { SCORE_WEIGHTS, type ScoreBreakdown } from './types.js'

type ScorerConfig = {
  evaluationDays: number
  holdThreshold?: number
}

type PriceOutcome = {
  actualReturn: number
  closePrices: number[]
}

type ScoreResult = {
  breakdown: ScoreBreakdown
  compositeScore: number
}

export class CompositeScorer {
  private readonly evaluationDays: number
  private readonly holdThreshold: number

  constructor(config: ScorerConfig) {
    this.evaluationDays = config.evaluationDays
    this.holdThreshold = config.holdThreshold ?? 0.02
  }

  score(decision: Decision, outcome: PriceOutcome): ScoreResult {
    const directional = this.scoreDirectional(decision, outcome)
    const targetHit = this.scoreTargetHit(decision, outcome)
    const calibration = this.scoreCalibration(decision, outcome)
    const holdPenalty = this.scoreHoldPenalty(decision, outcome)

    const breakdown: ScoreBreakdown = { directional, targetHit, calibration, holdPenalty }

    const compositeScore =
      breakdown.directional * SCORE_WEIGHTS.directional +
      breakdown.targetHit * SCORE_WEIGHTS.targetHit +
      breakdown.calibration * SCORE_WEIGHTS.calibration +
      breakdown.holdPenalty * SCORE_WEIGHTS.holdPenalty

    return { breakdown, compositeScore }
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

  private scoreTargetHit(decision: Decision, outcome: PriceOutcome): number {
    if (decision.stopLoss == null && decision.takeProfit == null) return 0.5
    const entryPrice = outcome.closePrices[0]
    if (entryPrice == null) return 0.5
    const direction = ACTION_DIRECTION[decision.action]
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
    const direction = ACTION_DIRECTION[decision.action]
    if (direction === 0) return decision.confidence // HOLD
    const correct =
      (direction > 0 && outcome.actualReturn > 0) ||
      (direction < 0 && outcome.actualReturn <= 0)
    return correct ? decision.confidence : 1 - decision.confidence
  }

  private scoreHoldPenalty(decision: Decision, outcome: PriceOutcome): number {
    const direction = ACTION_DIRECTION[decision.action]
    if (direction !== 0) return 1 // Non-HOLD actions are not penalized
    const absReturn = Math.abs(outcome.actualReturn)
    return absReturn <= this.holdThreshold ? 1 : 0
  }
}
