import type { Orchestrator } from '../../orchestrator/Orchestrator.js'
import type { Decision, Market } from '../base/types.js'
import type { ScoredDecision } from './types.js'
import type { CompositeScorer } from './CompositeScorer.js'

type OhlcvBar = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type BacktesterConfig = {
  orchestrator: Orchestrator
  scorer: CompositeScorer
  ticker: string
  market: Market | string
  ohlcvBars: OhlcvBar[]
  evaluationDays: number
}

type PriceOutcome = {
  actualReturn: number
  closePrices: number[]
}

export class Backtester {
  private readonly orchestrator: Orchestrator
  private readonly scorer: CompositeScorer
  private readonly ticker: string
  private readonly market: Market
  private readonly bars: OhlcvBar[]
  private readonly evaluationDays: number

  constructor(config: BacktesterConfig) {
    this.orchestrator = config.orchestrator
    this.scorer = config.scorer
    this.ticker = config.ticker
    this.market = config.market as Market
    this.bars = config.ohlcvBars
    this.evaluationDays = config.evaluationDays
  }

  async replay(startDate: Date, endDate: Date): Promise<ScoredDecision[]> {
    const results: ScoredDecision[] = []

    for (let index = 0; index < this.bars.length; index++) {
      const bar = this.bars[index]
      if (!bar) continue

      const barDate = new Date(bar.date)
      if (barDate < startDate || barDate > endDate) continue
      if (index + this.evaluationDays >= this.bars.length) continue

      const lookaheadBars = this.bars.slice(index, index + this.evaluationDays + 1)
      const outcome = this.buildOutcome(lookaheadBars)

      let report
      try {
        report = await this.orchestrator.run(this.ticker, this.market)
      } catch {
        continue
      }

      const decision = report.finalDecision
      if (!decision) continue

      const scored = this.buildScoredDecision(barDate, decision, outcome)
      results.push(scored)
    }

    return results
  }

  private buildOutcome(bars: OhlcvBar[]): PriceOutcome {
    const closePrices = bars.map((bar) => bar.close)
    const entryPrice = closePrices[0] ?? 0
    const exitPrice = closePrices[closePrices.length - 1] ?? entryPrice
    const actualReturn = entryPrice === 0 ? 0 : (exitPrice - entryPrice) / entryPrice
    return { actualReturn, closePrices }
  }

  private buildScoredDecision(
    date: Date,
    decision: Decision,
    outcome: PriceOutcome,
  ): ScoredDecision {
    const { breakdown, compositeScore } = this.scorer.score(decision, outcome)
    const hitTakeProfit =
      decision.takeProfit != null &&
      outcome.closePrices.some((price) =>
        decision.action === 'BUY' ? price >= decision.takeProfit! : price <= decision.takeProfit!,
      )
    const hitStopLoss =
      decision.stopLoss != null &&
      outcome.closePrices.some((price) =>
        decision.action === 'BUY' ? price <= decision.stopLoss! : price >= decision.stopLoss!,
      )

    return {
      date,
      decision,
      actualReturn: outcome.actualReturn,
      hitTakeProfit,
      hitStopLoss,
      breakdown,
      compositeScore,
    }
  }
}
