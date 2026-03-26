// src/evaluation/AccuracyEvaluator.ts
import type { IEvaluator, EvaluationResult } from './IEvaluator.js'
import type { TradingReport } from '../agents/base/types.js'

/**
 * AccuracyEvaluator — measures directional accuracy and confidence calibration.
 * @param actualReturn Actual price return after the evaluation period
 *   (positive = price went up, negative = price went down).
 */
export class AccuracyEvaluator implements IEvaluator {
  constructor(private actualReturn: number) {}

  async evaluate(report: TradingReport): Promise<EvaluationResult> {
    const decision = report.finalDecision
    if (!decision) {
      return {
        score: 0,
        breakdown: { directionalAccuracy: 0, confidenceCalibration: 0 },
        notes: 'No final decision in report',
      }
    }

    const actualUp = this.actualReturn > 0

    let directionalAccuracy: number
    if (decision.action === 'HOLD') {
      directionalAccuracy = 0.5
    } else if (
      (decision.action === 'BUY' && actualUp) ||
      (decision.action === 'SELL' && !actualUp)
    ) {
      directionalAccuracy = 1
    } else {
      directionalAccuracy = 0
    }

    // Correct + confident = good. Wrong + confident = bad.
    const confidenceCalibration =
      directionalAccuracy === 1 ? decision.confidence : 1 - decision.confidence

    const score = (directionalAccuracy + confidenceCalibration) / 2

    return {
      score,
      breakdown: { directionalAccuracy, confidenceCalibration },
      notes: `Decision: ${decision.action} (confidence: ${decision.confidence.toFixed(2)}), actual return: ${(this.actualReturn * 100).toFixed(2)}%`,
    }
  }
}
