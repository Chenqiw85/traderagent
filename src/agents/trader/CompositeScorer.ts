// src/agents/trader/CompositeScorer.ts

import type { Decision } from '../base/types.js'
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
    if (decision.action === 'HOLD') return 0.5
    const priceUp = outcome.actualReturn > 0
    if (decision.action === 'BUY' && priceUp) return 1
    if (decision.action === 'SELL' && !priceUp) return 1
    return 0
  }

  private scoreTargetHit(decision: Decision, outcome: PriceOutcome): number {
    if (decision.stopLoss == null && decision.takeProfit == null) return 0.5
    const entryPrice = outcome.closePrices[0]
    if (entryPrice == null) return 0.5
    const isBuy = decision.action === 'BUY'
    for (const price of outcome.closePrices) {
      if (decision.takeProfit != null) {
        if (isBuy && price >= decision.takeProfit) return 1
        if (!isBuy && price <= decision.takeProfit) return 1
      }
      if (decision.stopLoss != null) {
        if (isBuy && price <= decision.stopLoss) return 0
        if (!isBuy && price >= decision.stopLoss) return 0
      }
    }
    return 0.5
  }

  private scoreCalibration(decision: Decision, outcome: PriceOutcome): number {
    if (decision.action === 'HOLD') return decision.confidence
    const correct =
      (decision.action === 'BUY' && outcome.actualReturn > 0) ||
      (decision.action === 'SELL' && outcome.actualReturn <= 0)
    return correct ? decision.confidence : 1 - decision.confidence
  }

  private scoreHoldPenalty(decision: Decision, outcome: PriceOutcome): number {
    if (decision.action !== 'HOLD') return 1
    const absReturn = Math.abs(outcome.actualReturn)
    return absReturn <= this.holdThreshold ? 1 : 0
  }
}
