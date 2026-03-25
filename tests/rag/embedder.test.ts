// tests/rag/embedder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Embedder } from '../../src/rag/embedder.js'

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockImplementation(({ input }: { input: string | string[] }) => {
        const inputs = Array.isArray(input) ? input : [input]
        return Promise.resolve({
          data: inputs.map((_, i) => ({
            index: i,
            embedding: new Array(1536).fill(0.01 * (i + 1)),
          })),
        })
      }),
    },
  })),
}))

describe('Embedder', () => {
  let embedder: Embedder

  beforeEach(() => {
    embedder = new Embedder({ apiKey: 'test-key' })
  })

  it('embeds a single text', async () => {
    const result = await embedder.embed('hello world')
    expect(result).toHaveLength(1536)
    expect(typeof result[0]).toBe('number')
  })

  it('embeds a batch of texts', async () => {
    const results = await embedder.embedBatch(['hello', 'world', 'test'])
    expect(results).toHaveLength(3)
    results.forEach((vec) => {
      expect(vec).toHaveLength(1536)
    })
  })

  it('embedBatch returns empty for empty input', async () => {
    const results = await embedder.embedBatch([])
    expect(results).toEqual([])
  })

  it('maintains order in batch results', async () => {
    const results = await embedder.embedBatch(['first', 'second'])
    // First embedding should have smaller values than second
    expect(results[0][0]).toBeLessThan(results[1][0])
  })
})
