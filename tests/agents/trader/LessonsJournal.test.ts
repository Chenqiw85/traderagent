import { describe, it, expect, vi } from 'vitest'
import { LessonsJournal } from '../../../src/agents/trader/LessonsJournal.js'
import type { IVectorStore, Document } from '../../../src/rag/IVectorStore.js'
import type { IEmbedder } from '../../../src/rag/IEmbedder.js'
import type { LessonEntry } from '../../../src/agents/trader/types.js'

function mockVectorStore(): IVectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function mockEmbedder(): IEmbedder {
  return {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  }
}

function makeLesson(overrides: Partial<LessonEntry> = {}): LessonEntry {
  return {
    id: 'lesson-1',
    condition: 'RSI oversold + declining volume',
    lesson: 'Wait for volume confirmation',
    evidence: '5 of 7 trades were losses',
    confidence: 0.85,
    passNumber: 1,
    ticker: 'AAPL',
    market: 'US',
    ...overrides,
  }
}

describe('LessonsJournal', () => {
  it('stores lessons in vector store with correct metadata', async () => {
    const vs = mockVectorStore()
    const emb = mockEmbedder()
    const journal = new LessonsJournal({ vectorStore: vs, embedder: emb })

    await journal.store([makeLesson()])

    expect(vs.upsert).toHaveBeenCalledOnce()
    const docs = vi.mocked(vs.upsert).mock.calls[0]?.[0] as Document[]
    expect(docs).toHaveLength(1)
    expect(docs[0]?.metadata).toEqual(
      expect.objectContaining({
        type: 'lesson',
        ticker: 'AAPL',
        market: 'US',
        passNumber: 1,
      }),
    )
  })

  it('builds content string from lesson fields', async () => {
    const vs = mockVectorStore()
    const emb = mockEmbedder()
    const journal = new LessonsJournal({ vectorStore: vs, embedder: emb })

    await journal.store([makeLesson()])

    const docs = vi.mocked(vs.upsert).mock.calls[0]?.[0] as Document[]
    expect(docs[0]?.content).toContain('RSI oversold + declining volume')
    expect(docs[0]?.content).toContain('Wait for volume confirmation')
  })

  it('retrieves lessons filtered by ticker and type', async () => {
    const vs = mockVectorStore()
    const emb = mockEmbedder()
    vi.mocked(vs.search).mockResolvedValue([
      {
        id: 'lesson-1',
        content: 'Condition: RSI oversold\nLesson: Wait for confirmation',
        metadata: { type: 'lesson', ticker: 'AAPL' },
      },
    ])

    const journal = new LessonsJournal({ vectorStore: vs, embedder: emb })
    const results = await journal.retrieve('bullish signals AAPL', 'AAPL', 3)

    expect(vs.search).toHaveBeenCalledOnce()
    expect(results).toHaveLength(1)
    expect(results[0]).toContain('RSI oversold')
  })

  it('returns empty array when no vector store', async () => {
    const journal = new LessonsJournal({})
    const results = await journal.retrieve('test query', 'AAPL', 3)
    expect(results).toEqual([])
  })
})
