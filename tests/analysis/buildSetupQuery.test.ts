import { describe, expect, it } from 'vitest'
import { buildSetupQuery } from '../../src/analysis/buildSetupQuery.js'
import type { TradingReport } from '../../src/agents/base/types.js'

function makeReport(overrides: Partial<TradingReport> = {}): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-05T10:00:00Z'),
    rawData: [],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: ['Strong earnings'], confidence: 0.8 },
      { agentName: 'bearResearcher', stance: 'bear', evidence: ['Rich valuation'], confidence: 0.6 },
    ],
    computedIndicators: {
      trend: {
        sma50: 176,
        sma200: 162,
        ema12: 180.2,
        ema26: 177.4,
        macd: { line: 2.8, signal: 2.1, histogram: 0.7 },
      },
      momentum: {
        rsi: 71.4,
        stochastic: { k: 73.2, d: 68.9 },
      },
      volatility: {
        bollingerUpper: 186,
        bollingerMiddle: 178,
        bollingerLower: 170,
        atr: 4.3,
        historicalVolatility: 0.41,
      },
      volume: {
        obv: 8_500_000,
      },
      risk: {
        beta: 1.08,
        maxDrawdown: 0.14,
        var95: 0.027,
      },
      fundamentals: {
        pe: 27,
        pb: 11,
        dividendYield: 0.004,
        eps: 6.8,
      },
    },
    researchThesis: {
      stance: 'bull',
      confidence: 0.72,
      summary: 'Momentum and earnings revisions support upside.',
      keyDrivers: ['Earnings revisions'],
      keyRisks: ['Valuation'],
      invalidationConditions: ['Break below 50DMA'],
      timeHorizon: 'swing',
    },
    analysisArtifacts: [],
    ...overrides,
  }
}

describe('buildSetupQuery', () => {
  it('includes ticker, market, bullish thesis cues, and regime cues', () => {
    const query = buildSetupQuery(makeReport())

    expect(query).toContain('AAPL')
    expect(query).toContain('US')
    expect(query).toContain('bullish setup')
    expect(query).toContain('RSI overbought')
    expect(query).toContain('high-volatility regime')
  })

  it('switches to bearish setup cues when the thesis is bearish', () => {
    const query = buildSetupQuery(
      makeReport({
        researchThesis: {
          stance: 'bear',
          confidence: 0.61,
          summary: 'Trend and breadth are deteriorating.',
          keyDrivers: ['Weak breadth'],
          keyRisks: ['Oversold bounce'],
          invalidationConditions: ['Reclaim the 50DMA'],
          timeHorizon: 'short',
        },
        computedIndicators: {
          trend: {
            sma50: 158,
            sma200: 172,
            ema12: 160,
            ema26: 163,
            macd: { line: -1.2, signal: -0.8, histogram: -0.4 },
          },
          momentum: {
            rsi: 28.6,
            stochastic: { k: 24.4, d: 27.1 },
          },
          volatility: {
            bollingerUpper: 171,
            bollingerMiddle: 165,
            bollingerLower: 159,
            atr: 5.1,
            historicalVolatility: 0.18,
          },
          volume: {
            obv: -4_200_000,
          },
          risk: {
            beta: 1.22,
            maxDrawdown: 0.19,
            var95: 0.033,
          },
          fundamentals: {
            pe: 19,
            pb: 4.3,
            dividendYield: 0.008,
            eps: 5.2,
          },
        },
      }),
    )

    expect(query).toContain('bearish setup')
    expect(query).toContain('RSI oversold')
    expect(query).toContain('downtrend regime')
  })

  it('does not count the synthesized researchManager finding toward consensus', () => {
    const query = buildSetupQuery(
      makeReport({
        researchFindings: [
          { agentName: 'bullResearcher', stance: 'bull', evidence: ['Strong earnings'], confidence: 0.8 },
          { agentName: 'bearResearcher', stance: 'bear', evidence: ['Rich valuation'], confidence: 0.6 },
          { agentName: 'researchManager', stance: 'bull', evidence: ['Synthetic thesis'], confidence: 0.9 },
        ],
      }),
    )

    expect(query).toContain('mixed research debate')
    expect(query).not.toContain('bullish research consensus')
    expect(query).not.toContain('bearish research consensus')
  })

  it('includes an explicit lesson-oriented phrase for retrieval queries', () => {
    const query = buildSetupQuery(makeReport())

    expect(query).toContain('trading decision lessons')
  })
})
