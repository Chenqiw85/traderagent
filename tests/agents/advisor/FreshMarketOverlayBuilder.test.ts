import { describe, expect, it, vi } from 'vitest'
import { FreshMarketOverlayBuilder } from '../../../src/agents/advisor/FreshMarketOverlayBuilder.js'
import type { IDataSource } from '../../../src/data/IDataSource.js'
import type { TradingReport, LiveMarketSnapshot } from '../../../src/agents/base/types.js'
import type { ILiveMarketDataSource } from '../../../src/data/ILiveMarketDataSource.js'

function makeDataSource(): IDataSource {
  return {
    name: 'mock-source',
    fetch: vi.fn(),
  }
}

function makeLiveMarketSource(snapshot: LiveMarketSnapshot): ILiveMarketDataSource {
  return {
    name: 'mock-live-source',
    fetchLiveSnapshot: vi.fn().mockResolvedValue(snapshot),
  }
}

describe('FreshMarketOverlayBuilder', () => {
  it('builds an overlay from the latest completed close plus a fresh live anchor', async () => {
    const dataSource = makeDataSource()
    const fetch = dataSource.fetch as ReturnType<typeof vi.fn>
    fetch
      .mockResolvedValueOnce({
        ticker: 'AAPL',
        market: 'US',
        type: 'ohlcv',
        data: [
          { timestamp: '2026-04-06T20:00:00.000Z', open: 180, high: 182, low: 179, close: 181, volume: 1000 },
          { timestamp: '2026-04-07T20:00:00.000Z', open: 181, high: 184, low: 180, close: 183, volume: 1200 },
        ],
        fetchedAt: new Date('2026-04-07T20:01:00.000Z'),
      })
      .mockResolvedValueOnce({
        ticker: 'AAPL',
        market: 'US',
        type: 'news',
        data: [
          { title: 'Apple supplier demand improves', description: 'Faster order flow is lifting sentiment.' },
        ],
        fetchedAt: new Date('2026-04-07T20:01:30.000Z'),
      })
    const liveMarketDataSource = makeLiveMarketSource({
      source: 'mock-live-source',
      fetchedAt: new Date('2026-04-08T12:30:00.000Z'),
      marketState: 'PRE',
      preMarketPrice: 184,
      preMarketTime: new Date('2026-04-08T12:29:00.000Z'),
      currency: 'USD',
    })

    const technicalAnalyzer = {
      run: vi.fn().mockResolvedValue({
        computedIndicators: {
          trend: {
            sma50: 175,
            sma200: 160,
            ema12: 180,
            ema26: 176,
            macd: { line: 2, signal: 1, histogram: 1 },
          },
          momentum: {
            rsi: 62,
            stochastic: { k: 70, d: 65 },
          },
          volatility: {
            bollingerUpper: 185,
            bollingerMiddle: 177,
            bollingerLower: 169,
            atr: 3,
            historicalVolatility: 0.2,
          },
          volume: { obv: 1000 },
          risk: { beta: 1.1, maxDrawdown: 0.14, var95: 0.03 },
          fundamentals: { pe: 28, pb: 35, dividendYield: 0.004, eps: 6.5 },
        },
      } as TradingReport),
    }

    const builder = new FreshMarketOverlayBuilder({
      dataSource,
      liveMarketDataSource,
      technicalAnalyzer: technicalAnalyzer as never,
    })

    const overlay = await builder.build({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-08T12:30:00.000Z'),
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(technicalAnalyzer.run).toHaveBeenCalledTimes(1)
    expect(overlay.latestClose).toBe(184)
    expect(overlay.previousClose).toBe(183)
    expect(overlay.changePercent).toBeCloseTo(((184 - 183) / 183) * 100, 6)
    expect(overlay.newsItems).toEqual([
      'Apple supplier demand improves - Faster order flow is lifting sentiment.',
    ])
    expect(overlay.indicators.momentum.rsi).toBe(62)
    expect(overlay.indicators.trend.macd.histogram).toBe(1)
  })

  it('tolerates missing news by returning an empty news list', async () => {
    const dataSource = makeDataSource()
    const fetch = dataSource.fetch as ReturnType<typeof vi.fn>
    fetch
      .mockResolvedValueOnce({
        ticker: 'AAPL',
        market: 'US',
        type: 'ohlcv',
        data: [
          { timestamp: '2026-04-06T20:00:00.000Z', open: 180, high: 182, low: 179, close: 181, volume: 1000 },
          { timestamp: '2026-04-07T20:00:00.000Z', open: 181, high: 184, low: 180, close: 183, volume: 1200 },
        ],
        fetchedAt: new Date('2026-04-07T20:01:00.000Z'),
      })
      .mockRejectedValueOnce(new Error('news unavailable'))
    const liveMarketDataSource = makeLiveMarketSource({
      source: 'mock-live-source',
      fetchedAt: new Date('2026-04-08T12:30:00.000Z'),
      marketState: 'PRE',
      preMarketPrice: 184,
      preMarketTime: new Date('2026-04-08T12:29:00.000Z'),
      currency: 'USD',
    })

    const technicalAnalyzer = {
      run: vi.fn().mockResolvedValue({
        computedIndicators: {
          trend: {
            sma50: 175,
            sma200: 160,
            ema12: 180,
            ema26: 176,
            macd: { line: 2, signal: 1, histogram: 1 },
          },
          momentum: {
            rsi: 62,
            stochastic: { k: 70, d: 65 },
          },
          volatility: {
            bollingerUpper: 185,
            bollingerMiddle: 177,
            bollingerLower: 169,
            atr: 3,
            historicalVolatility: 0.2,
          },
          volume: { obv: 1000 },
          risk: { beta: 1.1, maxDrawdown: 0.14, var95: 0.03 },
          fundamentals: { pe: 28, pb: 35, dividendYield: 0.004, eps: 6.5 },
        },
      } as TradingReport),
    }

    const builder = new FreshMarketOverlayBuilder({
      dataSource,
      liveMarketDataSource,
      technicalAnalyzer: technicalAnalyzer as never,
    })

    const overlay = await builder.build({
      ticker: 'AAPL',
      market: 'US',
      asOf: new Date('2026-04-08T12:30:00.000Z'),
    })

    expect(overlay.newsItems).toEqual([])
    expect(overlay.latestClose).toBe(184)
    expect(technicalAnalyzer.run).toHaveBeenCalledTimes(1)
  })

  it('rejects insufficient OHLCV history', async () => {
    const dataSource = makeDataSource()
    const fetch = dataSource.fetch as ReturnType<typeof vi.fn>
    fetch
      .mockResolvedValueOnce({
        ticker: 'AAPL',
        market: 'US',
        type: 'ohlcv',
        data: [],
        fetchedAt: new Date('2026-04-07T20:01:00.000Z'),
      })
      .mockResolvedValueOnce({
        ticker: 'AAPL',
        market: 'US',
        type: 'news',
        data: [],
        fetchedAt: new Date('2026-04-07T20:01:30.000Z'),
      })
    const liveMarketDataSource = makeLiveMarketSource({
      source: 'mock-live-source',
      fetchedAt: new Date('2026-04-08T12:30:00.000Z'),
      marketState: 'PRE',
      preMarketPrice: 184,
      preMarketTime: new Date('2026-04-08T12:29:00.000Z'),
      currency: 'USD',
    })

    const builder = new FreshMarketOverlayBuilder({
      dataSource,
      liveMarketDataSource,
      technicalAnalyzer: {
        run: vi.fn(),
      } as never,
    })

    await expect(
      builder.build({
        ticker: 'AAPL',
        market: 'US',
        asOf: new Date('2026-04-08T12:30:00.000Z'),
      }),
    ).rejects.toThrow('FreshMarketOverlayBuilder: insufficient OHLCV bars for AAPL')
  })

  it('rejects overlays when the live anchor is stale', async () => {
    const dataSource = makeDataSource()
    const fetch = dataSource.fetch as ReturnType<typeof vi.fn>
    fetch
      .mockResolvedValueOnce({
        ticker: 'AAPL',
        market: 'US',
        type: 'ohlcv',
        data: [
          { timestamp: '2026-04-06T20:00:00.000Z', open: 180, high: 182, low: 179, close: 181, volume: 1000 },
          { timestamp: '2026-04-07T20:00:00.000Z', open: 181, high: 184, low: 180, close: 183, volume: 1200 },
        ],
        fetchedAt: new Date('2026-04-08T20:01:00.000Z'),
      })
      .mockResolvedValueOnce({
        ticker: 'AAPL',
        market: 'US',
        type: 'news',
        data: [],
        fetchedAt: new Date('2026-04-08T12:31:30.000Z'),
      })
    const liveMarketDataSource = makeLiveMarketSource({
      source: 'mock-live-source',
      fetchedAt: new Date('2026-04-08T12:30:00.000Z'),
      marketState: 'REGULAR',
      regularMarketPrice: 183.5,
      regularMarketTime: new Date('2026-04-07T20:00:00.000Z'),
      currency: 'USD',
    })

    const technicalAnalyzer = {
      run: vi.fn(),
    }

    const builder = new FreshMarketOverlayBuilder({
      dataSource,
      liveMarketDataSource,
      technicalAnalyzer: technicalAnalyzer as never,
    })

    await expect(
      builder.build({
        ticker: 'AAPL',
        market: 'US',
        asOf: new Date('2026-04-08T12:30:00.000Z'),
      }),
    ).rejects.toThrow('FreshMarketOverlayBuilder: stale live market price for AAPL')
    expect(technicalAnalyzer.run).not.toHaveBeenCalled()
  })
})
