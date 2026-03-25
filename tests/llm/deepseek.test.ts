// tests/llm/deepseek.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeepSeekProvider } from '../../src/llm/deepseek.js'

vi.mock('openai', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'Hello from DeepSeek' } }],
  })
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  }
})

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider

  beforeEach(() => {
    provider = new DeepSeekProvider({ apiKey: 'test-key', model: 'deepseek-chat' })
  })

  it('has correct name', () => {
    expect(provider.name).toBe('deepseek')
  })

  it('chat returns string response', async () => {
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello from DeepSeek')
  })
})
