import { describe, expect, it, vi } from 'vitest'
import { NextDayForecastSynthesizer } from '../../../src/agents/advisor/NextDayForecastSynthesizer.js'
import { computeSignalAlignment } from '../../../src/agents/advisor/SignalAlignmentScorer.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { ComputedIndicators } from '../../../src/agents/base/types.js'
import type { MarketTrend } from '../../../src/agents/advisor/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

const stubIndicators: ComputedIndicators = {
  trend: { sma50: 180, sma200: 170, ema12: 182, ema26: 179, macd: { line: 0.5, signal: 0.3, histogram: 0.2 } },
  momentum: { rsi: 55, stochastic: { k: 60, d: 55 } },
  volatility: { bollingerUpper: 190, bollingerMiddle: 183, bollingerLower: 176, atr: 2.5, historicalVolatility: 0.25 },
  volume: { obv: 100000 },
  risk: { beta: 1.1, maxDrawdown: 0.12, var95: 0.03 },
  fundamentals: { pe: 25, pb: 5, dividendYield: 0.005, eps: 6.5 },
}

const stubMarketTrends: MarketTrend[] = [
  { ticker: 'SPY', name: 'S&P 500', market: 'US', latestClose: 520, changePercent: 0.3, direction: 'bullish', rsi: 55, macdHistogram: 0.1, sma50: 515, sma200: 500, summary: 'Steady uptrend.' },
]

describe('NextDayForecastSynthesizer', () => {
  it('defaults the reference price to the latest close when omitted by the LLM', async () => {
    const synth = new NextDayForecastSynthesizer({
      llm: mockLLM(
        JSON.stringify({
          predictedDirection: 'up',
          confidence: 0.71,
          reasoning: 'Fresh momentum confirms the baseline thesis.',
          changeFromBaseline: 'strengthened',
        }),
      ),
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL',
      market: 'US',
      targetSession: new Date('2026-04-08T00:00:00.000Z'),
      baselineAction: 'BUY',
      baselineReferencePrice: 179,
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      newsItems: ['Supplier demand improves'],
      baselineSummary: 'Bullish swing thesis remains intact.',
      overlaySummary: 'Price reclaimed the 20DMA.',
      indicators: stubIndicators,
      marketTrends: stubMarketTrends,
    })

    if (forecast.predictedDirection === 'abstain') throw new Error('expected success')
    expect(forecast.referencePrice).toBe(183)
    expect(forecast.targetPrice).toBe(183)
    expect(forecast.predictedDirection).toBe('up')
    expect(forecast.targetSession).toBe('2026-04-08')
    expect(forecast.changeFromBaseline).toBe('strengthened')
  })

  it('returns abstain when LLM output is malformed twice', async () => {
    const synth = new NextDayForecastSynthesizer({
      llm: mockLLM(
        JSON.stringify({
          predictedDirection: 'sideways',
          referencePrice: -5,
          confidence: 1.4,
          reasoning: '',
          changeFromBaseline: 'boosted',
        }),
      ),
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL',
      market: 'US',
      targetSession: new Date('2026-04-08T00:00:00.000Z'),
      baselineAction: 'BUY',
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      newsItems: [],
      baselineSummary: 'Bullish swing thesis remains intact.',
      overlaySummary: 'Price reclaimed the 20DMA.',
      indicators: stubIndicators,
      marketTrends: stubMarketTrends,
    })

    expect(forecast.predictedDirection).toBe('abstain')
    if (forecast.predictedDirection === 'abstain') {
      expect(forecast.abstainReason).toBe('malformed-llm-output')
      expect(forecast.referencePrice).toBe(183)
    }
  })

  it('normalizes percentage confidence and rejects off-market reference prices', async () => {
    const synth = new NextDayForecastSynthesizer({
      llm: mockLLM(
        JSON.stringify({
          predictedDirection: 'down',
          referencePrice: 210,
          confidence: '71%',
          reasoning: 'Fresh weakness is pressuring the setup.',
          changeFromBaseline: 'weakened',
        }),
      ),
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL',
      market: 'US',
      targetSession: new Date('2026-04-08T00:00:00.000Z'),
      baselineAction: 'BUY',
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      newsItems: [],
      baselineSummary: 'Bullish swing thesis remains intact.',
      overlaySummary: 'Price reclaimed the 20DMA.',
      indicators: stubIndicators,
      marketTrends: stubMarketTrends,
    })

    if (forecast.predictedDirection === 'abstain') throw new Error('expected success')
    expect(forecast.predictedDirection).toBe('down')
    expect(forecast.referencePrice).toBe(183)
    // 210 is outside ATR range and 2% band, so targetPrice falls back to latest close
    expect(forecast.targetPrice).toBe(183)
    // 0.71 gets clamped to alignment band (±3% flex, hard cap 0.88)
    expect(forecast.confidence).toBeGreaterThanOrEqual(0.15)
    expect(forecast.confidence).toBeLessThanOrEqual(0.88)
    expect(forecast.changeFromBaseline).toBe('weakened')
  })

  it('normalizes whole-number confidence percentages from the LLM', async () => {
    const synth = new NextDayForecastSynthesizer({
      llm: mockLLM(
        JSON.stringify({
          predictedDirection: 'up',
          referencePrice: 183,
          confidence: 50,
          reasoning: 'Momentum is balanced but slightly constructive.',
          changeFromBaseline: 'unchanged',
        }),
      ),
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL',
      market: 'US',
      targetSession: new Date('2026-04-08T00:00:00.000Z'),
      baselineAction: 'BUY',
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      newsItems: [],
      baselineSummary: 'Bullish swing thesis remains intact.',
      overlaySummary: 'Price reclaimed the 20DMA.',
      indicators: stubIndicators,
      marketTrends: stubMarketTrends,
    })

    if (forecast.predictedDirection === 'abstain') throw new Error('expected success')
    // 50 normalizes to 0.50, then gets clamped to alignment band (±3% flex, hard cap 0.88)
    expect(forecast.confidence).toBeGreaterThanOrEqual(0.15)
    expect(forecast.confidence).toBeLessThanOrEqual(0.88)
  })

  it('accepts LLM target price within ATR-based target range', async () => {
    // ATR is 2.5, so target range is roughly 183 ± 2.0
    const synth = new NextDayForecastSynthesizer({
      llm: mockLLM(
        JSON.stringify({
          predictedDirection: 'up',
          targetPrice: 184.5,
          confidence: 0.65,
          reasoning: 'Bullish momentum with ATR-based target.',
          changeFromBaseline: 'strengthened',
        }),
      ),
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL',
      market: 'US',
      targetSession: new Date('2026-04-08T00:00:00.000Z'),
      baselineAction: 'BUY',
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      newsItems: [],
      baselineSummary: 'Bullish thesis intact.',
      overlaySummary: 'Momentum rising.',
      indicators: stubIndicators,
      marketTrends: stubMarketTrends,
    })

    if (forecast.predictedDirection === 'abstain') throw new Error('expected success')
    // referencePrice is always the session anchor (latestClose)
    expect(forecast.referencePrice).toBe(183)
    // 184.5 is within ATR range [181, 185], so should be accepted as targetPrice
    expect(forecast.targetPrice).toBe(184.5)
  })

  it('rejects a down forecast target price that sits above the latest close', async () => {
    const synth = new NextDayForecastSynthesizer({
      llm: mockLLM(
        JSON.stringify({
          predictedDirection: 'down',
          targetPrice: 184.5,
          confidence: 0.65,
          reasoning: 'Weakness should continue.',
          changeFromBaseline: 'weakened',
        }),
      ),
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL',
      market: 'US',
      targetSession: new Date('2026-04-08T00:00:00.000Z'),
      baselineAction: 'BUY',
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      newsItems: [],
      baselineSummary: 'Bullish thesis intact.',
      overlaySummary: 'Momentum fading.',
      indicators: stubIndicators,
      marketTrends: stubMarketTrends,
    })

    if (forecast.predictedDirection === 'abstain') throw new Error('expected success')
    expect(forecast.predictedDirection).toBe('down')
    expect(forecast.referencePrice).toBe(183)
    expect(forecast.targetPrice).toBe(183)
  })

  it('injects PAST PERFORMANCE block when accuracy provider returns stats', async () => {
    const chatSpy = vi.fn().mockResolvedValue(JSON.stringify({
      predictedDirection: 'up',
      confidence: 0.7,
      reasoning: 'r',
      targetPrice: 183,
      changeFromBaseline: 'unchanged',
    }))
    const synth = new NextDayForecastSynthesizer({
      llm: { name: 'm', chat: chatSpy, chatStream: vi.fn() as any },
      accuracyProvider: {
        getStats: vi.fn().mockResolvedValue({
          sampleSize: 18,
          directionalHitRate: 0.58,
          calibrationByBucket: {
            high: { promised: 0.77, actual: 0.50, n: 6 },
            moderate: { promised: 0.60, actual: 0.67, n: 9 },
            low: { promised: 0.35, actual: 0.33, n: 3 },
          },
          targetBandHitRate: 0.61,
        }),
      },
    })

    await synth.synthesize({
      ticker: 'AAPL', market: 'US',
      targetSession: new Date('2026-04-13T00:00:00Z'),
      baselineAction: 'BUY', latestClose: 183, previousClose: 181, changePercent: 1.1,
      newsItems: [], baselineSummary: '', overlaySummary: '',
      indicators: stubIndicators, marketTrends: stubMarketTrends,
    })

    const systemPrompt = chatSpy.mock.calls[0][0][0].content as string
    expect(systemPrompt).toMatch(/PAST PERFORMANCE/i)
    expect(systemPrompt).toContain('58%')
    expect(systemPrompt).toContain('n=18')
    expect(systemPrompt).toContain('HIGH')
    expect(systemPrompt).toContain('61%')
  })

  it('omits PAST PERFORMANCE block when accuracy provider returns null', async () => {
    const chatSpy = vi.fn().mockResolvedValue(JSON.stringify({
      predictedDirection: 'up', confidence: 0.7, reasoning: 'r',
      targetPrice: 183, changeFromBaseline: 'unchanged',
    }))
    const synth = new NextDayForecastSynthesizer({
      llm: { name: 'm', chat: chatSpy, chatStream: vi.fn() as any },
      accuracyProvider: { getStats: vi.fn().mockResolvedValue(null) },
    })

    await synth.synthesize({
      ticker: 'AAPL', market: 'US',
      targetSession: new Date('2026-04-13T00:00:00Z'),
      baselineAction: 'BUY', latestClose: 183, previousClose: 181, changePercent: 1.1,
      newsItems: [], baselineSummary: '', overlaySummary: '',
      indicators: stubIndicators, marketTrends: stubMarketTrends,
    })

    const systemPrompt = chatSpy.mock.calls[0][0][0].content as string
    expect(systemPrompt).not.toMatch(/PAST PERFORMANCE/i)
  })

  it('continues synthesis when accuracyProvider.getStats rejects', async () => {
    const chatSpy = vi.fn().mockResolvedValue(JSON.stringify({
      predictedDirection: 'up', confidence: 0.7, reasoning: 'r',
      targetPrice: 183, changeFromBaseline: 'unchanged',
    }))
    const synth = new NextDayForecastSynthesizer({
      llm: { name: 'm', chat: chatSpy, chatStream: vi.fn() as any },
      accuracyProvider: { getStats: vi.fn().mockRejectedValue(new Error('db')) },
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL', market: 'US',
      targetSession: new Date('2026-04-13T00:00:00Z'),
      baselineAction: 'BUY', latestClose: 183, previousClose: 181, changePercent: 1.1,
      newsItems: [], baselineSummary: '', overlaySummary: '',
      indicators: stubIndicators, marketTrends: stubMarketTrends,
    })

    expect(forecast.predictedDirection).toBe('up')
  })

  it('retries once when the first LLM response is malformed, then succeeds', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(JSON.stringify({
        predictedDirection: 'up', confidence: 0.7, reasoning: 'r',
        targetPrice: 183, changeFromBaseline: 'unchanged',
      }))
    const synth = new NextDayForecastSynthesizer({
      llm: { name: 'm', chat, chatStream: vi.fn() as any },
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL', market: 'US',
      targetSession: new Date('2026-04-13T00:00:00Z'),
      baselineAction: 'BUY', latestClose: 183, previousClose: 181, changePercent: 1.1,
      newsItems: [], baselineSummary: '', overlaySummary: '',
      indicators: stubIndicators, marketTrends: stubMarketTrends,
    })

    expect(chat).toHaveBeenCalledTimes(2)
    expect(forecast.predictedDirection).toBe('up')
    const retryUser = chat.mock.calls[1][0].find((m: any) => m.role === 'user')?.content
    expect(retryUser).toContain('JSON ONLY')
  })

  it('returns AbstainForecast when malformed twice', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('also not json')
    const synth = new NextDayForecastSynthesizer({
      llm: { name: 'm', chat, chatStream: vi.fn() as any },
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL', market: 'US',
      targetSession: new Date('2026-04-13T00:00:00Z'),
      baselineAction: 'BUY', latestClose: 183, previousClose: 181, changePercent: 1.1,
      newsItems: [], baselineSummary: '', overlaySummary: '',
      indicators: stubIndicators, marketTrends: stubMarketTrends,
    })

    expect(forecast.predictedDirection).toBe('abstain')
    if (forecast.predictedDirection === 'abstain') {
      expect(forecast.abstainReason).toBe('malformed-llm-output')
      expect(forecast.referencePrice).toBe(183)
    }
  })

  it('emits atrRange derived from signal alignment in the successful forecast', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify({
      predictedDirection: 'up', confidence: 0.7, reasoning: 'r',
      targetPrice: 184, changeFromBaseline: 'unchanged',
    }))
    const synth = new NextDayForecastSynthesizer({
      llm: { name: 'm', chat, chatStream: vi.fn() as any },
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL', market: 'US',
      targetSession: new Date('2026-04-13T00:00:00Z'),
      baselineAction: 'BUY', latestClose: 183, previousClose: 181, changePercent: 1.1,
      newsItems: [], baselineSummary: '', overlaySummary: '',
      indicators: stubIndicators, marketTrends: stubMarketTrends,
    })

    if (forecast.predictedDirection !== 'abstain') {
      expect(forecast.atrRange?.[0]).toBeGreaterThan(0)
      expect(forecast.atrRange?.[1]).toBeGreaterThan(forecast.atrRange?.[0] ?? 0)
    } else {
      throw new Error('expected success')
    }
  })

  it('clamps confidence with ±3% flex (high band cannot exceed 0.88)', async () => {
    const chat = vi.fn().mockResolvedValue(JSON.stringify({
      predictedDirection: 'up', confidence: 0.99, reasoning: 'r',
      targetPrice: 183.5, changeFromBaseline: 'unchanged',
    }))
    const synth = new NextDayForecastSynthesizer({
      llm: { name: 'm', chat, chatStream: vi.fn() as any },
    })

    const forecast = await synth.synthesize({
      ticker: 'AAPL', market: 'US',
      targetSession: new Date('2026-04-13T00:00:00Z'),
      baselineAction: 'BUY', latestClose: 183, previousClose: 181, changePercent: 1.1,
      newsItems: [], baselineSummary: '', overlaySummary: '',
      indicators: stubIndicators, marketTrends: stubMarketTrends,
    })

    if (forecast.predictedDirection !== 'abstain') {
      expect(forecast.confidence).toBeLessThanOrEqual(0.88)
    }
  })
})

describe('computeSignalAlignment', () => {
  it('scores bullish-aligned signals higher than mixed signals', () => {
    const bullishAlignment = computeSignalAlignment({
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      indicators: stubIndicators,
      baselineAction: 'BUY',
      marketTrends: stubMarketTrends,
    })

    const mixedIndicators: ComputedIndicators = {
      ...stubIndicators,
      trend: { ...stubIndicators.trend, sma50: 190, sma200: 195, macd: { line: -0.5, signal: 0.3, histogram: -0.8 } },
      momentum: { rsi: 35, stochastic: { k: 30, d: 40 } },
    }

    const mixedAlignment = computeSignalAlignment({
      latestClose: 183,
      previousClose: 185,
      changePercent: -1.1,
      indicators: mixedIndicators,
      baselineAction: 'HOLD',
      marketTrends: [{ ...stubMarketTrends[0], direction: 'bearish' }],
    })

    expect(bullishAlignment.score).toBeGreaterThan(mixedAlignment.score)
  })

  it('computes ATR-based target price range', () => {
    const alignment = computeSignalAlignment({
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      indicators: stubIndicators,
      baselineAction: 'BUY',
      marketTrends: stubMarketTrends,
    })

    const [low, high] = alignment.targetPriceRange
    expect(low).toBeLessThan(183)
    expect(high).toBeGreaterThan(183)
    // ATR is 2.5, multiplier 0.8 → ±2.0
    expect(low).toBeCloseTo(181, 0)
    expect(high).toBeCloseTo(185, 0)
  })

  it('penalizes high volatility', () => {
    const normalVol = computeSignalAlignment({
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      indicators: stubIndicators,
      baselineAction: 'BUY',
      marketTrends: stubMarketTrends,
    })

    const highVolIndicators: ComputedIndicators = {
      ...stubIndicators,
      volatility: { ...stubIndicators.volatility, atr: 8, historicalVolatility: 0.6 },
    }

    const highVol = computeSignalAlignment({
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      indicators: highVolIndicators,
      baselineAction: 'BUY',
      marketTrends: stubMarketTrends,
    })

    expect(highVol.score).toBeLessThan(normalVol.score)
  })

  it('penalizes blocked risk verdict', () => {
    const approved = computeSignalAlignment({
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      indicators: stubIndicators,
      baselineAction: 'BUY',
      marketTrends: stubMarketTrends,
    })

    const blocked = computeSignalAlignment({
      latestClose: 183,
      previousClose: 181,
      changePercent: 1.1,
      indicators: stubIndicators,
      baselineAction: 'BUY',
      baselineRiskVerdict: {
        approved: false,
        summary: 'Too risky',
        blockers: ['High drawdown'],
        requiredAdjustments: [],
      },
      marketTrends: stubMarketTrends,
    })

    expect(blocked.score).toBeLessThan(approved.score)
  })

  it('treats neutral signal sets as very low alignment', () => {
    const neutralIndicators: ComputedIndicators = {
      ...stubIndicators,
      trend: {
        ...stubIndicators.trend,
        sma50: 183,
        sma200: 183,
        macd: { line: 0, signal: 0, histogram: 0 },
      },
      momentum: {
        rsi: 50,
        stochastic: { k: 50, d: 50 },
      },
      volatility: {
        ...stubIndicators.volatility,
        bollingerUpper: 185,
        bollingerMiddle: 183,
        bollingerLower: 181,
      },
    }

    const alignment = computeSignalAlignment({
      latestClose: 183,
      previousClose: 183,
      changePercent: 0,
      indicators: neutralIndicators,
      baselineAction: 'HOLD',
      marketTrends: [{ ...stubMarketTrends[0], direction: 'neutral', changePercent: 0, macdHistogram: 0 }],
    })

    expect(alignment.suggestedBand).toBe('very_low')
    expect(alignment.score).toBeLessThan(0.3)
  })
})
