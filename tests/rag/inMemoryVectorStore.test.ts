import { describe, it, expect } from 'vitest'
import { InMemoryVectorStore } from '../../src/rag/InMemoryVectorStore.js'

describe('InMemoryVectorStore', () => {
  it('stores and retrieves documents by vector similarity', async () => {
    const store = new InMemoryVectorStore()
    await store.upsert([
      { id: '1', content: 'bullish signal', embedding: [1, 0, 0], metadata: { ticker: 'AAPL' } },
      { id: '2', content: 'bearish signal', embedding: [0, 1, 0], metadata: { ticker: 'AAPL' } },
      { id: '3', content: 'neutral signal', embedding: [0, 0, 1], metadata: { ticker: 'GOOG' } },
    ])
    const results = await store.search([0.9, 0.1, 0], 2)
    expect(results.length).toBe(2)
    expect(results[0].id).toBe('1')
  })

  it('filters by metadata', async () => {
    const store = new InMemoryVectorStore()
    await store.upsert([
      { id: '1', content: 'AAPL data', embedding: [1, 0], metadata: { ticker: 'AAPL' } },
      { id: '2', content: 'GOOG data', embedding: [0.9, 0.1], metadata: { ticker: 'GOOG' } },
    ])
    const results = await store.search([1, 0], 5, { must: [{ ticker: 'GOOG' }] })
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('2')
  })

  it('deletes documents by id', async () => {
    const store = new InMemoryVectorStore()
    await store.upsert([{ id: '1', content: 'test', embedding: [1, 0], metadata: {} }])
    await store.delete(['1'])
    const results = await store.search([1, 0], 5)
    expect(results.length).toBe(0)
  })

  it('upserts (overwrites) existing documents', async () => {
    const store = new InMemoryVectorStore()
    await store.upsert([{ id: '1', content: 'old', embedding: [1, 0], metadata: {} }])
    await store.upsert([{ id: '1', content: 'new', embedding: [0, 1], metadata: {} }])
    const results = await store.search([0, 1], 1)
    expect(results[0].content).toBe('new')
  })
})
