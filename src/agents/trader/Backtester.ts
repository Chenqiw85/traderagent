import type { Orchestrator } from '../../orchestrator/Orchestrator.js'
import type { Decision, Market } from '../base/types.js'
import type { OhlcvBar, ScoredDecision } from './types.js'
import type { CompositeScorer } from './CompositeScorer.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('backtester')

type BacktesterConfig = {
  orchestratorFactory: (cutoffDate: Date) => Orchestrator
  scorer: CompositeScorer
  ticker: string
  market: Market
  ohlcvBars: OhlcvBar[]
  evaluationDays: number
}

type PriceOutcome = {
  actualReturn: number
  closePrices: number[]
}

export class Backtester {
  private readonly orchestratorFactory: (cutoffDate: Date) => Orchestrator
  private readonly scorer: CompositeScorer
  private readonly ticker: string
  private readonly market: Market
  private readonly bars: OhlcvBar[]
  private readonly evaluationDays: number

  constructor(config: BacktesterConfig) {
    this.orchestratorFactory = config.orchestratorFactory
    this.scorer = config.scorer
    this.ticker = config.ticker
    this.market = config.market
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

      // Create a date-filtered orchestrator for this bar to prevent look-ahead bias
      const orchestrator = this.orchestratorFactory(barDate)

      let report
      try {
        report = await orchestrator.run(this.ticker, this.market, {
          timestamp: barDate,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.error({ date: bar.date, error: message }, 'Orchestrator failed')
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
