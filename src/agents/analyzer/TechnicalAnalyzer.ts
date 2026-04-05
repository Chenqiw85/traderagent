import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, TradingReport, ComputedIndicators } from '../base/types.js'
import type { IDataSource } from '../../data/IDataSource.js'
import {
  calcSMA, calcEMA, calcMACD,
  calcRSI, calcStochastic,
  calcBollinger, calcATR, calcHistoricalVolatility,
  calcOBV,
  calcBeta, calcMaxDrawdown, calcVaR,
} from '../../indicators/index.js'
import { normalizeOhlcv } from '../../utils/normalizeOhlcv.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('tech-analyzer')

type TechnicalAnalyzerConfig = { dataSource: IDataSource }

export class TechnicalAnalyzer implements IAgent {
  readonly name = 'technicalAnalyzer'
  readonly role: AgentRole = 'data'
  private dataSource: IDataSource

  constructor(config: TechnicalAnalyzerConfig) {
    this.dataSource = config.dataSource
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const ohlcvResult = report.rawData.find((r) => r.type === 'ohlcv')
    if (!ohlcvResult) throw new Error(`TechnicalAnalyzer: missing OHLCV data for ${report.ticker}`)

    const bars = this.parseBars(ohlcvResult.data)
    if (bars.length < 30) throw new Error(`TechnicalAnalyzer: insufficient OHLCV data (${bars.length} bars, need >= 30)`)

    const closes = bars.map((b) => b.close)
    const highs = bars.map((b) => b.high)
    const lows = bars.map((b) => b.low)
    const volumes = bars.map((b) => b.volume)
    const stockReturns = this.calcReturns(closes)

    let marketReturns: number[] = []
    try {
      const spyResult = await this.dataSource.fetch({
        ticker: 'SPY',
        market: report.market,
        type: 'ohlcv',
        from: new Date(report.timestamp.getTime() - 365 * 86400000),
        to: report.timestamp,
      })
      const spyBars = this.parseBars(spyResult.data)
      marketReturns = this.calcReturns(spyBars.map((b) => b.close))
    } catch { log.warn('Could not fetch SPY for beta — using beta=1') }

    const fundResult = report.rawData.find((r) => r.type === 'fundamentals')
    const macd = calcMACD(closes)
    const bollinger = calcBollinger(closes, 20, 2)

    const computedIndicators: ComputedIndicators = {
      trend: { sma50: calcSMA(closes, 50), sma200: calcSMA(closes, 200), ema12: calcEMA(closes, 12), ema26: calcEMA(closes, 26), macd },
      momentum: { rsi: calcRSI(closes, 14), stochastic: calcStochastic(highs, lows, closes, 14) },
      volatility: { bollingerUpper: bollinger.upper, bollingerMiddle: bollinger.middle, bollingerLower: bollinger.lower, atr: calcATR(highs, lows, closes, 14), historicalVolatility: calcHistoricalVolatility(closes) },
      volume: { obv: calcOBV(closes, volumes) },
      risk: {
        beta: marketReturns.length >= 2 ? calcBeta(stockReturns.slice(-marketReturns.length), marketReturns) : 1,
        maxDrawdown: calcMaxDrawdown(closes),
        var95: calcVaR(stockReturns, 0.95),
      },
      fundamentals: this.extractFundamentals(fundResult?.data),
    }

    return { ...report, computedIndicators }
  }

  private parseBars(data: unknown) {
    const bars = normalizeOhlcv(data)
    if (bars.length === 0 && data && typeof data === 'object') {
      throw new Error(`TechnicalAnalyzer: unrecognized OHLCV data format (keys: ${Object.keys(data as object).join(', ')})`)
    }
    return bars
  }

  private calcReturns(prices: number[]): number[] {
    const returns: number[] = []
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) returns.push((prices[i] - prices[i - 1]) / prices[i - 1])
    }
    return returns
  }

  private extractFundamentals(data: unknown): ComputedIndicators['fundamentals'] {
    const defaults = { pe: null, pb: null, dividendYield: null, eps: null }
    if (!data || typeof data !== 'object') return defaults
    const d = data as Record<string, unknown>
    const summary = d.summary as Record<string, unknown> | undefined
    const keyStats = (summary?.defaultKeyStatistics ?? d.defaultKeyStatistics) as Record<string, unknown> | undefined
    const metrics = (d.metrics as Record<string, unknown>)?.metric as Record<string, unknown> | undefined
    return {
      pe: (keyStats?.trailingPE ?? metrics?.peBasicExclExtraTTM ?? d.trailingPE ?? null) as number | null,
      pb: (keyStats?.priceToBook ?? metrics?.pbAnnual ?? d.priceToBook ?? null) as number | null,
      dividendYield: (keyStats?.dividendYield ?? metrics?.dividendYieldIndicatedAnnual ?? d.dividendYield ?? null) as number | null,
      eps: (keyStats?.trailingEps ?? metrics?.epsBasicExclExtraItemsTTM ?? d.trailingEps ?? null) as number | null,
    }
  }
}
