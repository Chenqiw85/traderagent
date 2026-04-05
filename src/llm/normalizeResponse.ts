// src/llm/normalizeResponse.ts

/**
 * Normalizes LLM response content from various providers into a plain string.
 * Handles:
 * - Anthropic content blocks (text, thinking/reasoning)
 * - OpenAI structured output / function calls
 * - Gemini multi-part responses
 * - Plain string passthrough
 */

type ContentBlock = {
  type?: string
  text?: string
  content?: string
  value?: string
}

/**
 * Extract plain text from an LLM response that may contain
 * structured content blocks, reasoning blocks, or other formats.
 */
export function normalizeResponse(response: unknown): string {
  // Already a string — most common case
  if (typeof response === 'string') return response

  // Null / undefined
  if (response == null) return ''

  // Array of content blocks (Anthropic format)
  if (Array.isArray(response)) {
    return response
      .filter((block: ContentBlock) => {
        // Skip thinking/reasoning blocks, keep text blocks
        const type = block?.type
        return type === 'text' || type === undefined
      })
      .map((block: ContentBlock) => block?.text ?? block?.content ?? String(block))
      .join('')
  }

  // Object with content array (wrapped response)
  if (typeof response === 'object') {
    const obj = response as Record<string, unknown>

    // { content: [{ type: 'text', text: '...' }] }
    if (Array.isArray(obj['content'])) {
      return normalizeResponse(obj['content'])
    }

    // { text: '...' } — simple text wrapper
    if (typeof obj['text'] === 'string') return obj['text']

    // { content: '...' } — simple content wrapper
    if (typeof obj['content'] === 'string') return obj['content']

    // { message: { content: '...' } } — OpenAI chat completion format
    if (typeof obj['message'] === 'object' && obj['message'] != null) {
      const msg = obj['message'] as Record<string, unknown>
      if (typeof msg['content'] === 'string') return msg['content']
    }

    // Fallback: JSON stringify
    return JSON.stringify(response)
  }

  return String(response)
}
