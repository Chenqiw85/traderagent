// src/agents/researcher/FundamentalsScorer.ts
import type { TradingReport } from '../base/types.js'
import type { FundamentalScores } from '../../types/quality.js'

export class FundamentalsScorer {
  score(report: TradingReport): FundamentalScores {
    const data = this.extractFundamentals(report)
    const available: string[] = []
    const missing: string[] = []
    const valuation = this.scoreValuation(data, available, missing)
    const profitability = this.scoreProfitability(data, available, missing)
    const financialHealth = this.scoreFinancialHealth(data, available, missing)
    const growth = this.scoreGrowth(data, available, missing)
    return {
      valuation, profitability, financialHealth, growth,
      total: valuation + profitability + financialHealth + growth,
      availableMetrics: available, missingMetrics: missing,
    }
  }

  private extractFundamentals(report: TradingReport): Record<string, number | null> {
    const raw = report.rawData.find((d) => d.type === 'fundamentals')
    const rawData = (raw?.data ?? {}) as Record<string, unknown>
    return {
      pe: this.num(rawData['pe']),
      pb: this.num(rawData['pb']),
      evToEbitda: this.num(rawData['evToEbitda']),
      roe: this.num(rawData['roe']),
      margins: this.num(rawData['margins']),
      revenueGrowth: this.num(rawData['revenueGrowth']),
      debtToEquity: this.num(rawData['debtToEquity']),
      currentRatio: this.num(rawData['currentRatio']),
      interestCoverage: this.num(rawData['interestCoverage']),
      epsGrowth: this.num(rawData['epsGrowth']),
      dividendYield: this.num(rawData['dividendYield']),
      eps: this.num(rawData['eps']),
    }
  }

  private num(v: unknown): number | null {
    return typeof v === 'number' && !Number.isNaN(v) ? v : null
  }

  private scoreValuation(data: Record<string, number | null>, available: string[], missing: string[]): number {
    const scores: number[] = []
    if (data.pe != null) {
      available.push('pe')
      if (data.pe < 15) scores.push(25)
      else if (data.pe < 25) scores.push(15 + (25 - data.pe) / 10 * 10)
      else if (data.pe < 50) scores.push(3 + (50 - data.pe) / 25 * 5)
      else scores.push(3)
    } else { missing.push('pe') }
    if (data.pb != null) {
      available.push('pb')
      if (data.pb < 1) scores.push(25)
      else if (data.pb < 3) scores.push(12 + (3 - data.pb) / 2 * 8)
      else if (data.pb < 10) scores.push(2 + (10 - data.pb) / 7 * 10)
      else scores.push(2)
    } else { missing.push('pb') }
    if (data.evToEbitda != null) {
      available.push('evToEbitda')
      if (data.evToEbitda < 10) scores.push(25)
      else if (data.evToEbitda < 20) scores.push(12 + (20 - data.evToEbitda) / 10 * 13)
      else if (data.evToEbitda < 40) scores.push(3 + (40 - data.evToEbitda) / 20 * 9)
      else scores.push(3)
    } else { missing.push('evToEbitda') }
    return this.prorate(scores, 25)
  }

  private scoreProfitability(data: Record<string, number | null>, available: string[], missing: string[]): number {
    const scores: number[] = []
    if (data.roe != null) {
      available.push('roe')
      if (data.roe > 0.20) scores.push(25)
      else if (data.roe > 0.10) scores.push(12 + (data.roe - 0.10) / 0.10 * 13)
      else if (data.roe > 0) scores.push(data.roe / 0.10 * 12)
      else scores.push(0)
    } else { missing.push('roe') }
    if (data.margins != null) {
      available.push('margins')
      if (data.margins > 0.20) scores.push(25)
      else if (data.margins > 0.10) scores.push(12 + (data.margins - 0.10) / 0.10 * 13)
      else if (data.margins > 0) scores.push(data.margins / 0.10 * 12)
      else scores.push(0)
    } else { missing.push('margins') }
    if (data.revenueGrowth != null) {
      available.push('revenueGrowth')
      if (data.revenueGrowth > 0.20) scores.push(25)
      else if (data.revenueGrowth > 0.10) scores.push(12 + (data.revenueGrowth - 0.10) / 0.10 * 13)
      else if (data.revenueGrowth > 0) scores.push(data.revenueGrowth / 0.10 * 12)
      else scores.push(0)
    } else { missing.push('revenueGrowth') }
    return this.prorate(scores, 25)
  }

  private scoreFinancialHealth(data: Record<string, number | null>, available: string[], missing: string[]): number {
    const scores: number[] = []
    if (data.debtToEquity != null) {
      available.push('debtToEquity')
      if (data.debtToEquity < 0.5) scores.push(25)
      else if (data.debtToEquity < 1.0) scores.push(15 + (1.0 - data.debtToEquity) / 0.5 * 10)
      else if (data.debtToEquity < 2.0) scores.push(5 + (2.0 - data.debtToEquity) / 1.0 * 10)
      else scores.push(2)
    } else { missing.push('debtToEquity') }
    if (data.currentRatio != null) {
      available.push('currentRatio')
      if (data.currentRatio > 2.0) scores.push(25)
      else if (data.currentRatio > 1.0) scores.push(12 + (data.currentRatio - 1.0) / 1.0 * 13)
      else if (data.currentRatio > 0.5) scores.push((data.currentRatio - 0.5) / 0.5 * 12)
      else scores.push(0)
    } else { missing.push('currentRatio') }
    if (data.interestCoverage != null) {
      available.push('interestCoverage')
      if (data.interestCoverage > 10) scores.push(25)
      else if (data.interestCoverage > 3) scores.push(10 + (data.interestCoverage - 3) / 7 * 15)
      else if (data.interestCoverage > 1) scores.push((data.interestCoverage - 1) / 2 * 10)
      else scores.push(0)
    } else { missing.push('interestCoverage') }
    return this.prorate(scores, 25)
  }

  private scoreGrowth(data: Record<string, number | null>, available: string[], missing: string[]): number {
    const scores: number[] = []
    if (data.revenueGrowth != null) {
      // revenueGrowth already tracked in profitability, don't double-track
      if (data.revenueGrowth > 0.20) scores.push(25)
      else if (data.revenueGrowth > 0.10) scores.push(12 + (data.revenueGrowth - 0.10) / 0.10 * 13)
      else if (data.revenueGrowth > 0) scores.push(data.revenueGrowth / 0.10 * 12)
      else scores.push(0)
    }
    if (data.epsGrowth != null) {
      available.push('epsGrowth')
      if (data.epsGrowth > 0.20) scores.push(25)
      else if (data.epsGrowth > 0.10) scores.push(12 + (data.epsGrowth - 0.10) / 0.10 * 13)
      else if (data.epsGrowth > 0) scores.push(data.epsGrowth / 0.10 * 12)
      else scores.push(0)
    } else { missing.push('epsGrowth') }
    return this.prorate(scores, 25)
  }

  private prorate(scores: number[], maxDimension: number): number {
    if (scores.length === 0) return 0
    const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length
    return Math.round(Math.min(avg, maxDimension) * 100) / 100
  }
}
