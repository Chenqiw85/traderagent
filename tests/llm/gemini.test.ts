// tests/llm/gemini.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GeminiProvider } from '../../src/llm/gemini.js'

vi.mock('@google/generative-ai', () => {
  const mockGenerateContent = vi.fn().mockResolvedValue({
    response: { text: () => 'Hello from Gemini' },
  })
  const mockGenerateContentStream = vi.fn().mockResolvedValue({
    stream: (async function* () {
      yield { text: () => 'Hello' }
      yield { text: () => ' Gemini' }
    })(),
  })
  const mockGetGenerativeModel = vi.fn().mockReturnValue({
    generateContent: mockGenerateContent,
    generateContentStream: mockGenerateContentStream,
  })
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
  }
})

describe('GeminiProvider', () => {
  let provider: GeminiProvider

  beforeEach(() => {
    provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-2.0-flash' })
  })

  it('has correct name', () => {
    expect(provider.name).toBe('gemini')
  })

  it('chat returns string response', async () => {
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello from Gemini')
  })

  it('chatStream yields string chunks', async () => {
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['Hello', ' Gemini'])
  })
})
