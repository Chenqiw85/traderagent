import { describe, it, expect } from 'vitest'
import { TechnicalAnalyzer } from '../../src/agents/analyzer/TechnicalAnalyzer.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataResult, TradingReport } from '../../src/agents/base/types.js'

function makeOHLCV(days: number) {
  const data: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = []
  let price = 150
  for (let i = 0; i < days; i++) {
    const change = (Math.random() - 0.48) * 3
    const open = price
    const close = price + change
    const high = Math.max(open, close) + Math.random() * 2
    const low = Math.min(open, close) - Math.random() * 2
    data.push({
      date: new Date(Date.now() - (days - i) * 86400000).toISOString().slice(0, 10),
      open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2),
      volume: Math.floor(50_000_000 + Math.random() * 20_000_000),
    })
    price = close
  }
  return data
}

function makeReport(ohlcvData: unknown): TradingReport {
  return {
    ticker: 'AAPL', market: 'US', timestamp: new Date(),
    rawData: [
      { ticker: 'AAPL', market: 'US', type: 'ohlcv', data: ohlcvData, fetchedAt: new Date() },
      { ticker: 'AAPL', market: 'US', type: 'fundamentals',
        data: { summary: { financialData: { currentPrice: 150 }, defaultKeyStatistics: { trailingPE: 30, priceToBook: 45, trailingEps: 6.5 } } },
        fetchedAt: new Date() },
    ],
    researchFindings: [],
  }
}

const spySource: IDataSource = {
  name: 'spy-stub',
  async fetch() {
    return { ticker: 'SPY', market: 'US', type: 'ohlcv', data: makeOHLCV(250), fetchedAt: new Date() }
  },
}

describe('TechnicalAnalyzer', () => {
  it('populates computedIndicators on the report', async () => {
    const analyzer = new TechnicalAnalyzer({ dataSource: spySource })
    const report = await analyzer.run(makeReport(makeOHLCV(250)))
    expect(report.computedIndicators).toBeDefined()
    const ci = report.computedIndicators!
    expect(typeof ci.trend.sma50).toBe('number')
    expect(typeof ci.trend.sma200).toBe('number')
    expect(typeof ci.trend.macd.line).toBe('number')
    expect(ci.momentum.rsi).toBeGreaterThanOrEqual(0)
    expect(ci.momentum.rsi).toBeLessThanOrEqual(100)
    expect(ci.volatility.bollingerUpper).toBeGreaterThan(ci.volatility.bollingerLower)
    expect(ci.volatility.atr).toBeGreaterThan(0)
    expect(ci.volatility.historicalVolatility).toBeGreaterThan(0)
    expect(typeof ci.volume.obv).toBe('number')
    expect(typeof ci.risk.beta).toBe('number')
    expect(ci.risk.maxDrawdown).toBeGreaterThanOrEqual(0)
    expect(ci.risk.var95).toBeGreaterThan(0)
  })

  it('throws when OHLCV data is missing', async () => {
    const analyzer = new TechnicalAnalyzer({ dataSource: spySource })
    const report: TradingReport = { ticker: 'AAPL', market: 'US', timestamp: new Date(), rawData: [], researchFindings: [] }
    await expect(analyzer.run(report)).rejects.toThrow('missing OHLCV')
  })

  it('extracts fundamentals from rawData when available', async () => {
    const analyzer = new TechnicalAnalyzer({ dataSource: spySource })
    const report = await analyzer.run(makeReport(makeOHLCV(250)))
    expect(report.computedIndicators!.fundamentals.pe).not.toBeNull()
  })
})
