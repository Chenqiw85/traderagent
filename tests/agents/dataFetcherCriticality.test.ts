import { describe, it, expect } from 'vitest'
import { DataFetcher } from '../../src/agents/data/DataFetcher.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataQuery, DataResult, TradingReport } from '../../src/agents/base/types.js'

function makeReport(ticker = 'AAPL', market: 'US' | 'CN' | 'HK' = 'US'): TradingReport {
  return { ticker, market, timestamp: new Date(), rawData: [], researchFindings: [] }
}

function makeSource(supportedTypes: string[]): IDataSource {
  return {
    name: 'test-source',
    async fetch(query: DataQuery): Promise<DataResult> {
      if (!supportedTypes.includes(query.type)) {
        throw new Error(`Unsupported: ${query.type}`)
      }
      return { ticker: query.ticker, market: query.market, type: query.type, data: { mock: true }, fetchedAt: new Date() }
    },
  }
}

describe('DataFetcher criticality enforcement', () => {
  it('throws when a critical data type (ohlcv) fails from all sources', async () => {
    const fetcher = new DataFetcher({ dataSources: [makeSource(['news'])] })
    await expect(fetcher.run(makeReport())).rejects.toThrow('ABORT')
    await expect(fetcher.run(makeReport())).rejects.toThrow('ohlcv')
  })

  it('succeeds when all critical types are fetched, even if optional (news) fails', async () => {
    const fetcher = new DataFetcher({ dataSources: [makeSource(['ohlcv', 'fundamentals', 'technicals'])] })
    const report = await fetcher.run(makeReport())
    expect(report.rawData.length).toBe(3)
  })

  it('succeeds when all four types are fetched', async () => {
    const fetcher = new DataFetcher({ dataSources: [makeSource(['ohlcv', 'fundamentals', 'technicals', 'news'])] })
    const report = await fetcher.run(makeReport())
    expect(report.rawData.length).toBe(4)
  })
})
