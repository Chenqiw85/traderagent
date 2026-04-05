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
  rateLimitRetries?: number
  rateLimitBaseDelayMs?: number
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])

function getStatusCode(err: unknown): number | undefined {
  if (err != null && typeof err === 'object' && 'status' in err) {
    return (err as { status: number }).status
  }
  return undefined
}

function getRetryAfterMs(err: unknown): number | undefined {
  if (err != null && typeof err === 'object' && 'headers' in err) {
    const headers = (err as { headers: Record<string, string> }).headers
    const retryAfter = headers?.['retry-after']
    if (retryAfter) {
      const seconds = Number(retryAfter)
      if (!isNaN(seconds)) return seconds * 1000
    }
  }
  return undefined
}

function isRateLimit(err: unknown): boolean {
  const status = getStatusCode(err)
  if (status === 429) return true
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('rate limit') || msg.includes('429')) return true
  }
  return false
}

function isRetryable(err: unknown): boolean {
  if (isRateLimit(err)) return true
  const status = getStatusCode(err)
  if (status && RETRYABLE_STATUS_CODES.has(status)) return true
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('timeout') || msg.includes('econnreset')) return true
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
  private rateLimitRetries: number
  private rateLimitBaseDelayMs: number

  constructor(inner: ILLMProvider, config?: RetryConfig) {
    this.inner = inner
    this.name = inner.name
    this.maxRetries = config?.maxRetries ?? 3
    this.baseDelayMs = config?.baseDelayMs ?? 1000
    this.maxDelayMs = config?.maxDelayMs ?? 30_000
    this.rateLimitRetries = config?.rateLimitRetries ?? 5
    this.rateLimitBaseDelayMs = config?.rateLimitBaseDelayMs ?? 10_000
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    let lastError: unknown
    let errorRetries = 0
    let rateLimitRetries = 0

    const maxAttempts = this.maxRetries + this.rateLimitRetries
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        return await this.inner.chat(messages, options)
      } catch (err) {
        lastError = err

        if (isRateLimit(err) && rateLimitRetries < this.rateLimitRetries) {
          rateLimitRetries++
          const retryAfter = getRetryAfterMs(err)
          const backoff = retryAfter ?? this.rateLimitBaseDelayMs * Math.pow(2, rateLimitRetries - 1)
          const delay = Math.min(backoff, 120_000) // cap at 2 minutes
          log.warn({ provider: this.name, rateLimitAttempt: rateLimitRetries, delayMs: delay }, 'Rate limited (429), backing off')
          await new Promise((r) => setTimeout(r, delay))
        } else if (!isRateLimit(err) && isRetryable(err) && errorRetries < this.maxRetries) {
          errorRetries++
          const delay = Math.min(
            this.baseDelayMs * Math.pow(2, errorRetries - 1),
            this.maxDelayMs,
          )
          log.warn({ provider: this.name, attempt: errorRetries, delayMs: delay }, 'LLM call failed, retrying')
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
