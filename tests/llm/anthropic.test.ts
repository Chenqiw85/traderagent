// tests/llm/anthropic.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnthropicProvider } from '../../src/llm/anthropic.js'

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Hello from Anthropic' }],
  })
  const mockStream = vi.fn().mockImplementation(async function* () {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' Claude' } }
  })
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockImplementation((opts) =>
          opts.stream ? mockStream() : mockCreate()
        ),
      },
    })),
  }
})

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider

  beforeEach(() => {
    provider = new AnthropicProvider({ apiKey: 'test-key', model: 'claude-sonnet-4-6' })
  })

  it('has correct name', () => {
    expect(provider.name).toBe('anthropic')
  })

  it('chat returns string response', async () => {
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello from Anthropic')
  })

  it('chatStream yields string chunks', async () => {
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['Hello', ' Claude'])
  })
})
