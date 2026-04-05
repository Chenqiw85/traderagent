import { describe, it, expect } from 'vitest'
import { BM25Index } from '../../src/rag/BM25Index.js'

describe('BM25Index', () => {
  it('adds documents and searches by keyword', () => {
    const index = new BM25Index()
    index.add('doc1', 'Apple stock price surged today after earnings beat expectations')
    index.add('doc2', 'Tesla deliveries fell short of analyst predictions')
    index.add('doc3', 'Apple announced a new iPhone with improved battery life')

    const results = index.search('Apple stock', 2)
    expect(results).toHaveLength(2)
    expect(results[0]?.id).toBe('doc1') // Most relevant
  })

  it('returns empty for no-match query', () => {
    const index = new BM25Index()
    index.add('doc1', 'Bitcoin cryptocurrency blockchain')

    const results = index.search('Apple stock', 5)
    expect(results).toHaveLength(0)
  })

  it('removes documents from index', () => {
    const index = new BM25Index()
    index.add('doc1', 'Apple stock surge')
    index.add('doc2', 'Apple quarterly earnings')

    expect(index.size).toBe(2)
    index.remove('doc1')
    expect(index.size).toBe(1)

    const results = index.search('Apple stock', 5)
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('doc2')
  })

  it('updates existing document on re-add', () => {
    const index = new BM25Index()
    index.add('doc1', 'Apple stock')
    index.add('doc1', 'Tesla deliveries')

    expect(index.size).toBe(1)
    const results = index.search('Tesla', 5)
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('doc1')
  })

  it('respects topK limit', () => {
    const index = new BM25Index()
    for (let i = 0; i < 10; i++) {
      index.add(`doc${i}`, `stock market analysis report number ${i}`)
    }

    const results = index.search('stock market', 3)
    expect(results).toHaveLength(3)
  })

  it('returns empty for empty index', () => {
    const index = new BM25Index()
    const results = index.search('anything', 5)
    expect(results).toHaveLength(0)
  })

  it('returns empty for empty query', () => {
    const index = new BM25Index()
    index.add('doc1', 'some content')
    const results = index.search('', 5)
    expect(results).toHaveLength(0)
  })
})
