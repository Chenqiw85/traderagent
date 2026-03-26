// src/evaluation/BacktestEvaluator.ts
import type { IEvaluator, EvaluationResult } from './IEvaluator.js'
import type { TradingReport } from '../agents/base/types.js'
import { AccuracyEvaluator } from './AccuracyEvaluator.js'

export type BacktestEntry = {
  report: TradingReport
  actualReturn: number
}

export class BacktestEvaluator implements IEvaluator {
  constructor(private entries: BacktestEntry[]) {}

  /** evaluate() runs the full backtest (the report argument is ignored). */
  async evaluate(_report: TradingReport): Promise<EvaluationResult> {
    return this.runBacktest()
  }

  async runBacktest(): Promise<EvaluationResult> {
    if (this.entries.length === 0) {
      return { score: 0, breakdown: {}, notes: 'No backtest entries' }
    }

    const results = await Promise.all(
      this.entries.map((entry) =>
        new AccuracyEvaluator(entry.actualReturn).evaluate(entry.report)
      )
    )

    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length
    const winRate =
      results.filter((r) => r.breakdown.directionalAccuracy === 1).length / results.length

    const buyReturns = this.entries
      .filter((e) => e.report.finalDecision?.action === 'BUY')
      .map((e) => e.actualReturn)
    const sharpeRatio = this.computeSharpe(buyReturns)
    const maxDrawdown = this.computeMaxDrawdown(this.entries.map((e) => e.actualReturn))

    return {
      score: avgScore,
      breakdown: { winRate, sharpeRatio, maxDrawdown },
      notes: `Backtest over ${this.entries.length} periods. Win rate: ${(winRate * 100).toFixed(1)}%`,
    }
  }

  private computeSharpe(returns: number[]): number {
    if (returns.length === 0) return 0
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
    const stdDev = Math.sqrt(variance)
    return stdDev === 0 ? 0 : mean / stdDev
  }

  private computeMaxDrawdown(returns: number[]): number {
    let peak = 1
    let equity = 1
    let maxDd = 0
    for (const r of returns) {
      equity *= 1 + r
      if (equity > peak) peak = equity
      const dd = (peak - equity) / peak
      if (dd > maxDd) maxDd = dd
    }
    return maxDd
  }
}
