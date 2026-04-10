import { describe, it, expect, vi } from 'vitest'
import { DataQualityAssessor } from '../../../src/agents/data/DataQualityAssessor.js'
import type { TradingReport, DataResult } from '../../../src/agents/base/types.js'
import type { ILLMProvider, Message } from '../../../src/llm/ILLMProvider.js'

function makeLLM(advisory: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(advisory),
    chatStream: vi.fn(),
  }
}

function makeReport(rawData: DataResult[]): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-08'),
    rawData,
    researchFindings: [],
  }
}

function makeDataResult(type: string, data: unknown): DataResult {
  return {
    ticker: 'AAPL',
    market: 'US',
    type: type as DataResult['type'],
    data,
    fetchedAt: new Date('2026-04-08'),
  }
}

describe('DataQualityAssessor', () => {
  it('computes full completeness when all data present', async () => {
    const llm = makeLLM('All data available and recent.')
    const assessor = new DataQualityAssessor({ llm })

    const report = makeReport([
      makeDataResult('ohlcv', [{ date: '2026-04-07', open: 100, high: 105, low: 99, close: 103, volume: 1000000 }]),
      makeDataResult('fundamentals', { pe: 25, pb: 3.5, roe: 0.15, debtToEquity: 0.8, revenueGrowth: 0.12, epsGrowth: 0.10, margins: 0.22, currentRatio: 1.5, interestCoverage: 8, evToEbitda: 18, dividendYield: 0.015, eps: 6.5 }),
      makeDataResult('technicals', { rsi: 55, macd: { line: 1.2, signal: 0.8, histogram: 0.4 } }),
      makeDataResult('news', [{ title: 'Apple earnings beat', url: 'https://example.com', publishedAt: '2026-04-07' }]),
    ])

    const result = await assessor.run(report)

    expect(result.dataQuality).toBeDefined()
    expect(result.dataQuality!.ohlcv.completeness).toBe(1)
    expect(result.dataQuality!.overall).toBeGreaterThan(0.8)
    expect(result.dataQuality!.advisory).toBe('All data available and recent.')
  })

  it('flags missing fundamentals fields', async () => {
    const llm = makeLLM('Fundamentals partial — missing growth and debt metrics.')
    const assessor = new DataQualityAssessor({ llm })

    const report = makeReport([
      makeDataResult('ohlcv', [{ date: '2026-04-07', open: 100, high: 105, low: 99, close: 103, volume: 1000000 }]),
      makeDataResult('fundamentals', { pe: 25, pb: 3.5 }),
      makeDataResult('technicals', { rsi: 55 }),
      makeDataResult('news', []),
    ])

    const result = await assessor.run(report)

    expect(result.dataQuality!.fundamentals.available).toContain('pe')
    expect(result.dataQuality!.fundamentals.available).toContain('pb')
    expect(result.dataQuality!.fundamentals.missing.length).toBeGreaterThan(0)
    expect(result.dataQuality!.fundamentals.completeness).toBeLessThan(1)
  })

  it('sets completeness to 0 for missing data type', async () => {
    const llm = makeLLM('News data entirely missing.')
    const assessor = new DataQualityAssessor({ llm })

    const report = makeReport([
      makeDataResult('ohlcv', [{ date: '2026-04-07', open: 100, high: 105, low: 99, close: 103, volume: 1000000 }]),
      makeDataResult('fundamentals', { pe: 25 }),
      makeDataResult('technicals', { rsi: 55 }),
    ])

    const result = await assessor.run(report)

    expect(result.dataQuality!.news.completeness).toBe(0)
    expect(result.dataQuality!.news.available).toHaveLength(0)
    expect(result.dataQuality!.overall).toBeLessThan(1)
  })

  it('calls LLM with dimension summary to generate advisory', async () => {
    const llm = makeLLM('Advisory note.')
    const assessor = new DataQualityAssessor({ llm })

    const report = makeReport([
      makeDataResult('ohlcv', [{ date: '2026-04-07', open: 100, high: 105, low: 99, close: 103, volume: 1000000 }]),
      makeDataResult('fundamentals', { pe: 25 }),
      makeDataResult('technicals', { rsi: 55 }),
    ])

    await assessor.run(report)

    expect(llm.chat).toHaveBeenCalledOnce()
    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Message[]
    expect(messages[0].content).toContain('data quality')
  })
})
