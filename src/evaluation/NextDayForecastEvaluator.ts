import type { EvaluationResult } from './IEvaluator.js'

export type NextDayForecastEntry = {
  predictedDirection: 'up' | 'down' | 'flat'
  referencePrice: number
  targetPrice: number
  actualClose: number
  confidence: number
}

const FLAT_MOVE_THRESHOLD = 0.005

function computeMove(referencePrice: number, actualClose: number): number {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || !Number.isFinite(actualClose)) {
    return 0
  }

  return (actualClose - referencePrice) / referencePrice
}

function classifyMove(referencePrice: number, actualClose: number): 'up' | 'down' | 'flat' {
  const move = computeMove(referencePrice, actualClose)
  if (Math.abs(move) < FLAT_MOVE_THRESHOLD) return 'flat'
  return move > 0 ? 'up' : 'down'
}

function normalizeConfidence(confidence: number): number {
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.5
}

export class NextDayForecastEvaluator {
  constructor(private readonly entries: NextDayForecastEntry[]) {}

  async run(): Promise<EvaluationResult> {
    if (this.entries.length === 0) {
      return {
        score: 0,
        breakdown: {},
        notes: 'No next-day forecast entries',
      }
    }

    const results = this.entries.map((entry) => {
      const actualDirection = classifyMove(entry.referencePrice, entry.actualClose)
      const move = computeMove(entry.referencePrice, entry.actualClose)
      const signedReturn = entry.predictedDirection === 'up'
        ? move
        : entry.predictedDirection === 'down'
          ? -move
          : 0
      const hit = actualDirection === entry.predictedDirection ? 1 : 0
      const flatHit = entry.predictedDirection === 'flat' && actualDirection === 'flat' ? 1 : 0
      const calibration = hit === 1
        ? normalizeConfidence(entry.confidence)
        : 1 - normalizeConfidence(entry.confidence)

      return {
        hit,
        flatHit,
        signedReturn,
        calibration,
      }
    })

    const hitRate = results.reduce((sum, item) => sum + item.hit, 0) / results.length
    const flatCalls = results.filter((_, index) => this.entries[index].predictedDirection === 'flat')
    const flatPrecision = flatCalls.length > 0
      ? flatCalls.reduce((sum, item) => sum + item.flatHit, 0) / flatCalls.length
      : 0
    const avgSignedReturn = results.reduce((sum, item) => sum + item.signedReturn, 0) / results.length
    const confidenceCalibration = results.reduce((sum, item) => sum + item.calibration, 0) / results.length

    return {
      score: (hitRate + confidenceCalibration) / 2,
      breakdown: { hitRate, flatPrecision, avgSignedReturn, confidenceCalibration },
      notes: `Scored ${results.length} next-day forecasts`,
    }
  }
}
