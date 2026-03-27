import { describe, it, expect, vi } from 'vitest'
import { OllamaEmbedder } from '../../src/rag/OllamaEmbedder.js'

vi.mock('ollama', () => ({
  Ollama: class {
    constructor() {}
    async embed(opts: { model: string; input: string | string[] }) {
      const inputs = Array.isArray(opts.input) ? opts.input : [opts.input]
      return {
        embeddings: inputs.map((text) =>
          Array.from({ length: 4 }, (_, i) => text.length * 0.01 + i * 0.1),
        ),
      }
    }
  },
}))

describe('OllamaEmbedder', () => {
  it('embeds a single text and returns a number array', async () => {
    const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' })
    const result = await embedder.embed('hello world')
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(4)
    expect(typeof result[0]).toBe('number')
  })

  it('embeds a batch of texts', async () => {
    const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' })
    const results = await embedder.embedBatch(['hello', 'world'])
    expect(results.length).toBe(2)
    expect(results[0].length).toBe(4)
    expect(results[1].length).toBe(4)
  })
})
