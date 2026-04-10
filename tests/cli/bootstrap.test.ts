import { beforeEach, describe, expect, it } from 'vitest'
import { BM25VectorStore } from '../../src/rag/BM25VectorStore.js'
import { QdrantVectorStore } from '../../src/rag/qdrant.js'

process.env['DATABASE_URL'] = 'postgres://bootstrap-test'

const { buildDataSourceChain, buildLiveMarketSourceChain, buildRAGDeps } = await import('../../src/cli/bootstrap.js')

describe('cli bootstrap', () => {
  beforeEach(() => {
    delete process.env['DATABASE_URL']
    delete process.env['FINNHUB_API_KEY']
    delete process.env['OPENAI_API_KEY']
    delete process.env['QDRANT_URL']
    delete process.env['QDRANT_API_KEY']
    delete process.env['OLLAMA_HOST']
    delete process.env['RAG_BM25']
  })

  it('builds fallback chain with postgres, finnhub, then yfinance when configured', () => {
    process.env['DATABASE_URL'] = 'postgres://test'
    process.env['FINNHUB_API_KEY'] = 'finnhub-key'

    const chain = buildDataSourceChain('price-chain')
    const sources = (chain as unknown as { sources: Array<{ name: string }> }).sources

    expect(sources.map((source) => source.name)).toEqual(['postgres', 'finnhub', 'yfinance'])
  })

  it('always includes yfinance in fallback chain', () => {
    const chain = buildDataSourceChain('price-chain')
    const sources = (chain as unknown as { sources: Array<{ name: string }> }).sources

    expect(sources.map((source) => source.name)).toEqual(['yfinance'])
  })

  it('builds a fallback live market chain with yahoo live as the default source', () => {
    const chain = buildLiveMarketSourceChain('live-market-chain')
    const sources = (chain as unknown as { sources: Array<{ name: string }> }).sources

    expect(chain.name).toBe('live-market-chain')
    expect(sources.map((source) => source.name)).toEqual(['yahoo-live'])
  })

  it('builds qdrant dependencies when qdrant env is configured', () => {
    process.env['OPENAI_API_KEY'] = 'openai-key'
    process.env['QDRANT_URL'] = 'http://localhost:6333'

    const rag = buildRAGDeps()

    expect(rag.ragMode).toBe('qdrant')
    expect(rag.vectorStore).toBeInstanceOf(QdrantVectorStore)
    expect(rag.embedder).toBeDefined()
  })

  it('builds BM25 dependencies for local memory mode', () => {
    process.env['RAG_BM25'] = 'true'

    const rag = buildRAGDeps()

    expect(rag.ragMode).toBe('memory')
    expect(rag.vectorStore).toBeInstanceOf(BM25VectorStore)
    expect(rag.embedder).toBeUndefined()
  })
})
