// src/evaluation/IEvaluator.ts
import type { TradingReport } from '../agents/base/types.js'

export type EvaluationResult = {
  score: number
  breakdown: Record<string, number>
  notes: string
}

export interface IEvaluator {
  evaluate(report: TradingReport): Promise<EvaluationResult>
}
