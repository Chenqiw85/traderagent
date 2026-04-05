// tests/agents/dataFetcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataFetcher } from '../../src/agents/data/DataFetcher.js'
import { BM25VectorStore } from '../../src/rag/BM25VectorStore.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { IVectorStore } from '../../src/rag/IVectorStore.js'
import type { Embedder } from '../../src/rag/embedder.js'
import type { TradingReport } from '../../src/agents/base/types.js'

function createMockDataSource(name: string): IDataSource {
  return {
    name,
    fetch: vi.fn().mockImplementation((query) =>
      Promise.resolve({
        ticker: query.ticker,
        market: query.market,
        type: query.type,
        data: [{ close: 150 }],
        fetchedAt: new Date('2024-01-01'),
      }),
    ),
  }
}

function createMockVectorStore(): IVectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockEmbedder(): Embedder {
  return {
    embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    embedBatch: vi.fn().mockResolvedValue([new Array(1536).fill(0.1)]),
  } as unknown as Embedder
}

function createEmptyReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [],
  }
}

describe('DataFetcher', () => {
  it('has correct name and role', () => {
    const fetcher = new DataFetcher({ dataSources: [] })
    expect(fetcher.name).toBe('dataFetcher')
    expect(fetcher.role).toBe('data')
  })

  it('fetches from all data sources and writes to report', async () => {
    const source1 = createMockDataSource('source1')
    const source2 = createMockDataSource('source2')
    const fetcher = new DataFetcher({ dataSources: [source1, source2] })
    const report = createEmptyReport()

    const result = await fetcher.run(report)
    // Each source is called for 4 data types = 8 calls total
    expect(source1.fetch).toHaveBeenCalledTimes(4)
    expect(source2.fetch).toHaveBeenCalledTimes(4)
    expect(result.rawData.length).toBe(8)
  })

  it('gracefully handles data source failures', async () => {
    const goodSource = createMockDataSource('good')
    const badSource: IDataSource = {
      name: 'bad',
      fetch: vi.fn().mockRejectedValue(new Error('API down')),
    }
    const fetcher = new DataFetcher({ dataSources: [goodSource, badSource] })
    const report = createEmptyReport()

    const result = await fetcher.run(report)
    // Only good source results should be in the report
    expect(result.rawData.length).toBe(4)
  })

  it('embeds and stores data when vector store is configured', async () => {
    const source = createMockDataSource('test')
    const vectorStore = createMockVectorStore()
    const embedder = createMockEmbedder()

    const fetcher = new DataFetcher({
      dataSources: [source],
      vectorStore,
      embedder,
    })
    const report = createEmptyReport()

    await fetcher.run(report)
    expect(embedder.embedBatch).toHaveBeenCalled()
    expect(vectorStore.upsert).toHaveBeenCalled()
  })

  it('skips embedding when no vector store configured', async () => {
    const source = createMockDataSource('test')
    const fetcher = new DataFetcher({ dataSources: [source] })
    const report = createEmptyReport()

    const result = await fetcher.run(report)
    // Should still populate rawData
    expect(result.rawData.length).toBe(4)
  })

  it('stores documents in BM25 mode without embeddings', async () => {
    const source = createMockDataSource('test')
    const vectorStore = new BM25VectorStore()
    const upsertSpy = vi.spyOn(vectorStore, 'upsert')
    const fetcher = new DataFetcher({ dataSources: [source], vectorStore })

    await fetcher.run(createEmptyReport())

    expect(upsertSpy).toHaveBeenCalled()
  })

  it('preserves existing report data', async () => {
    const source = createMockDataSource('test')
    const fetcher = new DataFetcher({ dataSources: [source] })
    const report = createEmptyReport()
    report.rawData = [{
      ticker: 'AAPL',
      market: 'US',
      type: 'ohlcv',
      data: 'existing',
      fetchedAt: new Date(),
    }]

    const result = await fetcher.run(report)
    expect(result.rawData.length).toBe(5) // 1 existing + 4 new
  })

  it('forwards report timestamp as the fetch upper bound', async () => {
    const source = createMockDataSource('timed')
    const fetcher = new DataFetcher({ dataSources: [source] })
    const asOf = new Date('2025-06-10T00:00:00.000Z')
    const report: TradingReport = {
      ticker: 'AAPL',
      market: 'US',
      timestamp: asOf,
      rawData: [],
      researchFindings: [],
    }

    await fetcher.run(report)

    const calls = (source.fetch as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(4)
    for (const [query] of calls) {
      expect(query).toEqual(expect.objectContaining({
        ticker: 'AAPL',
        market: 'US',
        to: asOf,
      }))
    }
  })
})
