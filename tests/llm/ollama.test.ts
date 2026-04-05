// tests/llm/ollama.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OllamaProvider } from '../../src/llm/ollama.js'

vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockImplementation((opts: { stream?: boolean }) => {
      if (opts.stream) {
        // Return an async iterable for streaming
        return (async function* () {
          yield { message: { content: 'Hello from Ollama' } }
        })()
      }
      return Promise.resolve({ message: { content: 'Hello from Ollama' } })
    }),
  })),
}))

describe('OllamaProvider', () => {
  let provider: OllamaProvider

  beforeEach(() => {
    provider = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3.2' })
  })

  it('has correct name', () => {
    expect(provider.name).toBe('ollama')
  })

  it('chat returns string response', async () => {
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello from Ollama')
  })

  it('chatStream delegates to chat', async () => {
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }
    expect(chunks.join('')).toBe('Hello from Ollama')
  })
})
