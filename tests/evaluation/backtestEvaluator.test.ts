// tests/evaluation/backtestEvaluator.test.ts
import { describe, it, expect } from 'vitest'
import { BacktestEvaluator } from '../../src/evaluation/BacktestEvaluator.js'
import type { TradingReport } from '../../src/agents/base/types.js'

function reportWithDecision(action: 'BUY' | 'SELL' | 'HOLD', confidence: number): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [],
    finalDecision: { action, confidence, reasoning: 'test' },
  }
}

describe('BacktestEvaluator', () => {
  it('returns zero score for empty entries', async () => {
    const evaluator = new BacktestEvaluator([])
    const result = await evaluator.runBacktest()
    expect(result.score).toBe(0)
    expect(result.notes).toContain('No backtest entries')
  })

  it('computes win rate and aggregate score over entries', async () => {
    const entries = [
      { report: reportWithDecision('BUY', 0.8), actualReturn: 0.10 },   // correct
      { report: reportWithDecision('BUY', 0.7), actualReturn: -0.05 },  // wrong
      { report: reportWithDecision('SELL', 0.9), actualReturn: -0.08 }, // correct
    ]
    const evaluator = new BacktestEvaluator(entries)
    const result = await evaluator.runBacktest()
    expect(result.score).toBeGreaterThan(0)
    expect(result.breakdown.winRate).toBeCloseTo(2 / 3)
  })

  it('includes sharpeRatio and maxDrawdown in breakdown', async () => {
    const entries = [
      { report: reportWithDecision('BUY', 0.8), actualReturn: 0.10 },
      { report: reportWithDecision('BUY', 0.7), actualReturn: 0.05 },
    ]
    const evaluator = new BacktestEvaluator(entries)
    const result = await evaluator.runBacktest()
    expect(result.breakdown.sharpeRatio).toBeCloseTo(2.121, 2)
    expect(result.breakdown.maxDrawdown).toBeCloseTo(0, 5)
  })

  it('evaluate() delegates to runBacktest()', async () => {
    const entries = [{ report: reportWithDecision('BUY', 0.8), actualReturn: 0.10 }]
    const evaluator = new BacktestEvaluator(entries)
    const report = reportWithDecision('HOLD', 0.5)
    const result = await evaluator.evaluate(report)
    expect(result.score).toBeGreaterThan(0)
  })
})
