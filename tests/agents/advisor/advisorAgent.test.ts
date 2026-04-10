import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdvisorAgent } from '../../../src/agents/advisor/AdvisorAgent.js'

describe('AdvisorAgent', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds ticker advisories from baseline analysis plus fresh overlays', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-07T20:00:00.000Z'))

    const summaryLlm = {
      name: 'mock-summary',
      chat: vi.fn().mockResolvedValue('{"summary":"US tech remains constructive into the next session."}'),
      chatStream: vi.fn() as never,
    }
    const trendAnalyzer = {
      analyze: vi.fn().mockResolvedValue([
        {
          ticker: 'SPY',
          name: 'S&P 500',
          market: 'US',
          latestClose: 520,
          changePercent: 0.5,
          direction: 'bullish',
          rsi: 58,
          macdHistogram: 1.2,
          sma50: 505,
          sma200: 470,
          summary: 'Breadth is improving.',
        },
      ]),
    }
    const baselineService = {
      loadBaseline: vi.fn().mockResolvedValue({
        asOf: new Date('2026-04-07T20:00:00.000Z'),
        source: 'db',
        report: {
          ticker: 'AAPL',
          market: 'US',
          timestamp: new Date('2026-04-07T20:00:00.000Z'),
          rawData: [],
          researchFindings: [],
          analysisArtifacts: [],
          researchThesis: {
            stance: 'bull',
            confidence: 0.7,
            summary: 'Primary trend still points higher.',
            keyDrivers: ['Trend'],
            keyRisks: ['Valuation'],
            invalidationConditions: ['Lose support'],
            timeHorizon: 'swing',
          },
          traderProposal: {
            action: 'BUY',
            confidence: 0.66,
            summary: 'Buy the breakout.',
            entryLogic: 'Add above 183.',
            whyNow: 'Momentum aligned.',
            timeHorizon: 'swing',
            referencePrice: 183,
            invalidationConditions: ['Close below 178'],
          },
          riskVerdict: {
            approved: true,
            summary: 'Risk acceptable.',
            blockers: [],
            requiredAdjustments: [],
          },
          finalDecision: {
            action: 'HOLD',
            confidence: 0.7,
            reasoning: 'Baseline decision is neutral until confirmation.',
          },
        },
      }),
    }
    const overlayBuilder = {
      build: vi.fn().mockResolvedValue({
        asOf: new Date('2026-04-07T20:00:00.000Z'),
        latestClose: 184,
        previousClose: 182,
        changePercent: 1.09,
        indicators: {
          trend: { sma50: 175, sma200: 160, ema12: 181, ema26: 177, macd: { line: 2, signal: 1, histogram: 1 } },
          momentum: { rsi: 63, stochastic: { k: 73, d: 68 } },
          volatility: { bollingerUpper: 186, bollingerMiddle: 178, bollingerLower: 170, atr: 3, historicalVolatility: 0.21 },
          volume: { obv: 1000 },
          risk: { beta: 1.1, maxDrawdown: 0.14, var95: 0.03 },
          fundamentals: { pe: 28, pb: 35, dividendYield: 0.004, eps: 6.5 },
        },
        newsItems: ['Supplier demand improves'],
      }),
    }
    const forecastSynthesizer = {
      synthesize: vi.fn().mockResolvedValue({
        predictedDirection: 'up',
        referencePrice: 183,
        targetPrice: 184,
        targetSession: '2026-04-08',
        confidence: 0.72,
        reasoning: 'Fresh momentum strengthened the baseline thesis.',
        baselineAction: 'BUY',
        baselineReferencePrice: 183,
        changeFromBaseline: 'strengthened',
      }),
    }
    const forecastRepository = {
      saveMany: vi.fn().mockResolvedValue(undefined),
    }

    const agent = new AdvisorAgent({
      llm: summaryLlm,
      trendAnalyzer: trendAnalyzer as never,
      baselineService: baselineService as never,
      overlayBuilder: overlayBuilder as never,
      forecastSynthesizer: forecastSynthesizer as never,
      forecastRepository: forecastRepository as never,
      indices: [{ ticker: 'SPY', name: 'S&P 500', market: 'US' }],
    })

    const report = await agent.run([{ ticker: 'AAPL', market: 'US' }])

    expect(report.timestamp.toISOString()).toBe('2026-04-07T20:00:00.000Z')
    expect(report.tickerAdvisories).toHaveLength(1)
    expect(report.tickerAdvisories[0].forecast?.referencePrice).toBe(183)
    expect(report.tickerAdvisories[0].forecast?.targetPrice).toBe(184)
    expect(report.tickerAdvisories[0].baselineDecision?.action).toBe('HOLD')
    expect(report.tickerAdvisories[0].decision.action).toBe('BUY')
    expect(report.summary).toContain('constructive')
    expect(forecastRepository.saveMany).toHaveBeenCalledWith({
      issuedAt: new Date('2026-04-07T20:00:00.000Z'),
      advisories: report.tickerAdvisories,
    })
    expect(baselineService.loadBaseline).toHaveBeenCalledWith({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T20:00:00.000Z'),
      ragMode: undefined,
    })
    expect(overlayBuilder.build).toHaveBeenCalledWith({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-07T20:00:00.000Z'),
    })
    expect(forecastSynthesizer.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'AAPL',
        market: 'US',
        targetSession: new Date('2026-04-08T00:00:00.000Z'),
        baselineAction: 'HOLD',
        baselineReferencePrice: undefined,
        latestClose: 184,
        previousClose: 182,
        changePercent: 1.09,
        newsItems: ['Supplier demand improves'],
        baselineSummary: 'Primary trend still points higher.',
        indicators: expect.objectContaining({ momentum: expect.objectContaining({ rsi: 63 }) }),
        marketTrends: expect.any(Array),
        baselineThesis: expect.objectContaining({ stance: 'bull' }),
        baselineRiskVerdict: expect.objectContaining({ approved: true }),
      }),
    )
  })

  it('returns the advisory report even if forecast persistence fails', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-07T20:00:00.000Z'))

    const agent = new AdvisorAgent({
      llm: {
        name: 'mock-summary',
        chat: vi.fn().mockResolvedValue('{"summary":"US tech remains constructive into the next session."}'),
        chatStream: vi.fn() as never,
      },
      trendAnalyzer: {
        analyze: vi.fn().mockResolvedValue([]),
      } as never,
      baselineService: {
        loadBaseline: vi.fn().mockResolvedValue({
          asOf: new Date('2026-04-07T20:00:00.000Z'),
          source: 'db',
          report: {
            ticker: 'AAPL',
            market: 'US',
            timestamp: new Date('2026-04-07T20:00:00.000Z'),
            rawData: [],
            researchFindings: [],
            analysisArtifacts: [],
            finalDecision: {
              action: 'BUY',
              confidence: 0.7,
              reasoning: 'Baseline remains constructive.',
            },
          },
        }),
      } as never,
      overlayBuilder: {
        build: vi.fn().mockResolvedValue({
          asOf: new Date('2026-04-07T20:00:00.000Z'),
          latestClose: 184,
          previousClose: 182,
          changePercent: 1.09,
          indicators: {
            trend: { sma50: 175, sma200: 160, ema12: 181, ema26: 177, macd: { line: 2, signal: 1, histogram: 1 } },
            momentum: { rsi: 63, stochastic: { k: 73, d: 68 } },
            volatility: { bollingerUpper: 186, bollingerMiddle: 178, bollingerLower: 170, atr: 3, historicalVolatility: 0.21 },
            volume: { obv: 1000 },
            risk: { beta: 1.1, maxDrawdown: 0.14, var95: 0.03 },
            fundamentals: { pe: 28, pb: 35, dividendYield: 0.004, eps: 6.5 },
          },
          newsItems: [],
        }),
      } as never,
      forecastSynthesizer: {
        synthesize: vi.fn().mockResolvedValue({
          predictedDirection: 'up',
          referencePrice: 183,
          targetPrice: 184,
          targetSession: '2026-04-08',
          confidence: 0.72,
          reasoning: 'Fresh momentum strengthened the baseline thesis.',
          baselineAction: 'BUY',
          baselineReferencePrice: 183,
          changeFromBaseline: 'strengthened',
        }),
      } as never,
      forecastRepository: {
        saveMany: vi.fn().mockRejectedValue(new Error('db unavailable')),
      } as never,
      indices: [{ ticker: 'SPY', name: 'S&P 500', market: 'US' }],
    })

    const report = await agent.run([{ ticker: 'AAPL', market: 'US' }])

    expect(report.tickerAdvisories).toHaveLength(1)
    expect(report.summary).toContain('constructive')
  })
})
