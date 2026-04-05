// src/llm/withRetry.ts
// Retry wrapper for ILLMProvider — retries transient failures with exponential backoff.

import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('llm-retry')

type RetryConfig = {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('rate limit') || msg.includes('timeout') || msg.includes('econnreset')) {
      return true
    }
    // Check for HTTP status codes in the error
    for (const code of RETRYABLE_STATUS_CODES) {
      if (msg.includes(String(code))) return true
    }
  }
  return false
}

export class RetryLLMProvider implements ILLMProvider {
  readonly name: string
  private inner: ILLMProvider
  private maxRetries: number
  private baseDelayMs: number
  private maxDelayMs: number

  constructor(inner: ILLMProvider, config?: RetryConfig) {
    this.inner = inner
    this.name = inner.name
    this.maxRetries = config?.maxRetries ?? 3
    this.baseDelayMs = config?.baseDelayMs ?? 1000
    this.maxDelayMs = config?.maxDelayMs ?? 30_000
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.inner.chat(messages, options)
      } catch (err) {
        lastError = err
        if (attempt < this.maxRetries && isRetryable(err)) {
          const delay = Math.min(
            this.baseDelayMs * Math.pow(2, attempt),
            this.maxDelayMs,
          )
          log.warn({ provider: this.name, attempt: attempt + 1, delayMs: delay }, 'LLM call failed, retrying')
          await new Promise((r) => setTimeout(r, delay))
        } else {
          break
        }
      }
    }
    throw lastError
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    // No retry for streaming — pass through directly
    yield* this.inner.chatStream(messages, options)
  }
}
