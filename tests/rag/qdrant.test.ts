// tests/rag/qdrant.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QdrantVectorStore } from '../../src/rag/qdrant.js'

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn().mockImplementation(() => ({
    getCollections: vi.fn().mockResolvedValue({ collections: [] }),
    createCollection: vi.fn().mockResolvedValue(true),
    upsert: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue([
      {
        id: 'doc-1',
        score: 0.95,
        payload: { content: 'AAPL is up 5%', ticker: 'AAPL', type: 'news' },
      },
      {
        id: 'doc-2',
        score: 0.87,
        payload: { content: 'Revenue grew 10%', ticker: 'AAPL', type: 'fundamentals' },
      },
    ]),
    delete: vi.fn().mockResolvedValue(true),
  })),
}))

describe('QdrantVectorStore', () => {
  let store: QdrantVectorStore

  beforeEach(() => {
    store = new QdrantVectorStore({
      url: 'http://localhost:6333',
      collectionName: 'test-collection',
      vectorSize: 1536,
    })
  })

  it('ensureCollection creates collection if not exists', async () => {
    await expect(store.ensureCollection()).resolves.not.toThrow()
  })

  it('upsert inserts documents', async () => {
    await expect(
      store.upsert([
        {
          id: 'doc-1',
          content: 'test content',
          embedding: new Array(1536).fill(0.1),
          metadata: { ticker: 'AAPL' },
        },
      ]),
    ).resolves.not.toThrow()
  })

  it('upsert handles empty array', async () => {
    await expect(store.upsert([])).resolves.not.toThrow()
  })

  it('search returns documents', async () => {
    const results = await store.search(new Array(1536).fill(0.1), 5)
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('doc-1')
    expect(results[0].content).toBe('AAPL is up 5%')
    expect(results[0].metadata.ticker).toBe('AAPL')
  })

  it('search with filter', async () => {
    const results = await store.search(
      new Array(1536).fill(0.1),
      5,
      { must: [{ ticker: 'AAPL' }] },
    )
    expect(results).toBeDefined()
  })

  it('delete removes documents', async () => {
    await expect(store.delete(['doc-1', 'doc-2'])).resolves.not.toThrow()
  })

  it('delete handles empty array', async () => {
    await expect(store.delete([])).resolves.not.toThrow()
  })
})
