import { describe, it, expect, vi } from 'vitest'
import { BullResearcher } from '../../../src/agents/researcher/BullResearcher.js'
import { BM25VectorStore } from '../../../src/rag/BM25VectorStore.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { IVectorStore } from '../../../src/rag/IVectorStore.js'
import type { Embedder } from '../../../src/rag/embedder.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function mockVectorStore(): IVectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([{ id: '1', content: 'AAPL is undervalued', metadata: {} }]),
    delete: vi.fn(),
  }
}

function mockEmbedder(): Embedder {
  return {
    embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    embedBatch: vi.fn(),
  } as unknown as Embedder
}

function emptyReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [
      { type: 'ohlcv', ticker: 'AAPL', market: 'US', data: {}, fetchedAt: new Date() },
      { type: 'fundamentals', ticker: 'AAPL', market: 'US', data: {}, fetchedAt: new Date() },
    ],
    researchFindings: [],
  }
}

describe('BullResearcher', () => {
  it('has correct name and role', () => {
    const agent = new BullResearcher({ llm: mockLLM('{}') })
    expect(agent.name).toBe('bullResearcher')
    expect(agent.role).toBe('researcher')
  })

  it('appends a bull finding to researchFindings', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["Strong earnings growth"],"confidence":0.8}')
    const agent = new BullResearcher({ llm })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings).toHaveLength(1)
    expect(result.researchFindings[0].stance).toBe('bull')
    expect(result.researchFindings[0].agentName).toBe('bullResearcher')
    expect(result.researchFindings[0].confidence).toBe(0.8)
  })

  it('queries vector store when configured', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["test"],"confidence":0.7}')
    const vs = mockVectorStore()
    const embedder = mockEmbedder()
    const agent = new BullResearcher({ llm, vectorStore: vs, embedder })
    await agent.run(emptyReport())
    expect(embedder.embed).toHaveBeenCalled()
    expect(vs.search).toHaveBeenCalled()
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new BullResearcher({ llm: mockLLM('not valid json') })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings).toHaveLength(1)
    expect(result.researchFindings[0].stance).toBe('neutral')
    expect(result.researchFindings[0].confidence).toBe(0)
  })

  it('works without vector store configured', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["test"],"confidence":0.6}')
    const agent = new BullResearcher({ llm })
    const result = await agent.run(emptyReport())
    expect(llm.chat).toHaveBeenCalledOnce()
    expect(result.researchFindings).toHaveLength(1)
  })

  it('clamps out-of-range confidence to [0, 1]', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["test"],"confidence":3.7}')
    const agent = new BullResearcher({ llm })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].confidence).toBe(1)
  })

  it('defaults unrecognized stance to neutral', async () => {
    const llm = mockLLM('{"stance":"super_bullish","evidence":["test"],"confidence":0.5}')
    const agent = new BullResearcher({ llm })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].stance).toBe('neutral')
  })

  it('throws when only embedding-based vectorStore is provided without embedder', () => {
    const vs = mockVectorStore()
    expect(() => new BullResearcher({ llm: mockLLM('{}'), vectorStore: vs })).toThrow(
      'vectorStore and embedder must both be provided or both omitted'
    )
  })

  it('queries BM25 vector store without embedder', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["test"],"confidence":0.7}')
    const vs = new BM25VectorStore()
    await vs.upsert([
      {
        id: '1',
        content: 'AAPL has strong earnings momentum and bullish sentiment',
        metadata: { ticker: 'AAPL', market: 'US', type: 'news' },
      },
    ])

    const agent = new BullResearcher({ llm, vectorStore: vs })
    await agent.run(emptyReport())

    expect(llm.chat).toHaveBeenCalledOnce()
    const systemPrompt = vi.mocked(llm.chat).mock.calls[0]?.[0]?.[0]?.content ?? ''
    expect(systemPrompt).toContain('strong earnings momentum')
  })

  it('keeps lesson documents out of the generic market-doc budget', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["test"],"confidence":0.7}')
    const vs: IVectorStore = {
      upsert: vi.fn(),
      search: vi.fn()
        .mockResolvedValueOnce([
          { id: 'l1', content: 'Lesson A', metadata: { ticker: 'AAPL', type: 'lesson' } },
          { id: 'l2', content: 'Lesson B', metadata: { ticker: 'AAPL', type: 'lesson' } },
          { id: 'm1', content: 'Market Doc 1', metadata: { ticker: 'AAPL', type: 'news' } },
          { id: 'm2', content: 'Market Doc 2', metadata: { ticker: 'AAPL', type: 'ohlcv' } },
        ])
        .mockResolvedValueOnce([
          { id: 'l1', content: 'Lesson A', metadata: { ticker: 'AAPL', type: 'lesson' } },
        ]),
      delete: vi.fn(),
    }
    const embedder = mockEmbedder()
    const agent = new BullResearcher({ llm, vectorStore: vs, embedder, topK: 2 })

    await agent.run(emptyReport())

    const systemPrompt = vi.mocked(llm.chat).mock.calls[0]?.[0]?.[0]?.content ?? ''
    expect(systemPrompt).toContain('Market Doc 1')
    expect(systemPrompt).not.toMatch(/Lesson A[\s\S]*Lesson A/)
  })

  it('scopes vector lookups by both ticker and market', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["test"],"confidence":0.7}')
    const vs = mockVectorStore()
    const embedder = mockEmbedder()
    const agent = new BullResearcher({ llm, vectorStore: vs, embedder })

    await agent.run(emptyReport())

    expect(vs.search).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      10,
      { must: [{ ticker: 'AAPL' }, { market: 'US' }] },
    )
    expect(vs.search).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      3,
      { must: [{ ticker: 'AAPL' }, { market: 'US' }, { type: 'lesson' }] },
    )
  })

  it('records lesson retrieval events on the report', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["test"],"confidence":0.7}')
    const vs: IVectorStore = {
      upsert: vi.fn(),
      search: vi.fn()
        .mockResolvedValueOnce([
          { id: 'market-1', content: 'Market Doc 1', metadata: { ticker: 'AAPL', market: 'US', type: 'news' } },
        ])
        .mockResolvedValueOnce([
          {
            id: 'lesson-1',
            content: 'Lesson A',
            metadata: {
              ticker: 'AAPL',
              market: 'US',
              type: 'lesson',
              source: 'extractor',
              perspective: 'shared',
            },
          },
          {
            id: 'lesson-2',
            content: 'Lesson B',
            metadata: {
              ticker: 'AAPL',
              market: 'US',
              type: 'lesson',
              source: 'reflection',
              perspective: 'bull',
            },
          },
        ]),
      delete: vi.fn(),
    }
    const embedder = mockEmbedder()
    const agent = new BullResearcher({ llm, vectorStore: vs, embedder })
    const report = emptyReport()

    const result = await agent.run(report)

    expect(result.lessonRetrievals).toEqual([
      expect.objectContaining({
        lessonId: 'lesson-1',
        agent: 'bullResearcher',
        perspective: 'shared',
        source: 'extractor',
        ticker: 'AAPL',
        market: 'US',
        asOf: report.timestamp,
        rank: 1,
      }),
      expect.objectContaining({
        lessonId: 'lesson-2',
        agent: 'bullResearcher',
        perspective: 'bull',
        source: 'reflection',
        ticker: 'AAPL',
        market: 'US',
        asOf: report.timestamp,
        rank: 2,
      }),
    ])
    expect(result.lessonRetrievals?.[0]?.query).toContain('bullish investment signals and buy evidence for AAPL')
    expect(result.lessonRetrievals?.[0]?.query).toContain('trading decision lessons AAPL US')
  })

  it('keeps market docs available even when shared lesson docs dominate top ranks', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["test"],"confidence":0.7}')
    const docs = [
      { id: 'l1', content: 'Lesson 1', metadata: { ticker: 'AAPL', market: 'US', type: 'lesson', source: 'extractor', perspective: 'shared' } },
      { id: 'l2', content: 'Lesson 2', metadata: { ticker: 'AAPL', market: 'US', type: 'lesson', source: 'extractor', perspective: 'shared' } },
      { id: 'l3', content: 'Lesson 3', metadata: { ticker: 'AAPL', market: 'US', type: 'lesson', source: 'reflection', perspective: 'shared' } },
      { id: 'l4', content: 'Lesson 4', metadata: { ticker: 'AAPL', market: 'US', type: 'lesson', source: 'reflection', perspective: 'shared' } },
      { id: 'l5', content: 'Lesson 5', metadata: { ticker: 'AAPL', market: 'US', type: 'lesson', source: 'extractor', perspective: 'shared' } },
      { id: 'l6', content: 'Lesson 6', metadata: { ticker: 'AAPL', market: 'US', type: 'lesson', source: 'extractor', perspective: 'shared' } },
      { id: 'l7', content: 'Lesson 7', metadata: { ticker: 'AAPL', market: 'US', type: 'lesson', source: 'extractor', perspective: 'shared' } },
      { id: 'l8', content: 'Lesson 8', metadata: { ticker: 'AAPL', market: 'US', type: 'lesson', source: 'extractor', perspective: 'shared' } },
      { id: 'm1', content: 'Market Doc 1', metadata: { ticker: 'AAPL', market: 'US', type: 'news' } },
      { id: 'm2', content: 'Market Doc 2', metadata: { ticker: 'AAPL', market: 'US', type: 'ohlcv' } },
    ]
    const vs: IVectorStore = {
      upsert: vi.fn(),
      search: vi.fn().mockImplementation(async (_query, topK) => docs.slice(0, topK)),
      delete: vi.fn(),
    }
    const embedder = mockEmbedder()
    const agent = new BullResearcher({ llm, vectorStore: vs, embedder, topK: 2 })

    await agent.run(emptyReport())

    const systemPrompt = vi.mocked(llm.chat).mock.calls[0]?.[0]?.[0]?.content ?? ''
    expect(systemPrompt).toContain('Market Doc 1')
    expect(systemPrompt).toContain('Market Doc 2')
  })
})
