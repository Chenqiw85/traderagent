// tests/llm/openai.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAIProvider } from '../../src/llm/openai.js'

vi.mock('openai', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'Hello from OpenAI' } }],
  })
  const mockStream = vi.fn().mockImplementation(async function* () {
    yield { choices: [{ delta: { content: 'Hello' } }] }
    yield { choices: [{ delta: { content: ' world' } }] }
  })
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation((opts) =>
            opts.stream ? mockStream() : mockCreate()
          ),
        },
      },
    })),
  }
})

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider

  beforeEach(() => {
    provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' })
  })

  it('has correct name', () => {
    expect(provider.name).toBe('openai')
  })

  it('chat returns string response', async () => {
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello from OpenAI')
  })

  it('chatStream yields string chunks', async () => {
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['Hello', ' world'])
  })
})
