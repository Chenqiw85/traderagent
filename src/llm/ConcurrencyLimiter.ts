// src/llm/ConcurrencyLimiter.ts
// Wraps an ILLMProvider with a per-provider concurrency semaphore.
// Prevents parallel calls from stampeding the same API and triggering 429s.

import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'

type Resolver = () => void

export class ConcurrencyLimiter implements ILLMProvider {
  readonly name: string
  private inner: ILLMProvider
  private maxConcurrent: number
  private running: number
  private queue: Resolver[]

  /** Shared limiters keyed by provider name — ensures a single semaphore per provider */
  private static shared = new Map<string, { running: number; queue: Resolver[]; max: number }>()

  constructor(inner: ILLMProvider, maxConcurrent = 2) {
    this.inner = inner
    this.name = inner.name
    this.maxConcurrent = maxConcurrent

    // Share state across all ConcurrencyLimiter instances for the same provider
    const key = inner.name
    if (!ConcurrencyLimiter.shared.has(key)) {
      ConcurrencyLimiter.shared.set(key, { running: 0, queue: [], max: maxConcurrent })
    }
    const state = ConcurrencyLimiter.shared.get(key)!
    // Update max if a higher value is requested
    state.max = Math.max(state.max, maxConcurrent)
    this.running = state.running
    this.queue = state.queue
  }

  private get state() {
    return ConcurrencyLimiter.shared.get(this.inner.name)!
  }

  private async acquire(): Promise<void> {
    const state = this.state
    if (state.running < state.max) {
      state.running++
      return
    }
    return new Promise<void>((resolve) => {
      state.queue.push(resolve)
    })
  }

  private release(): void {
    const state = this.state
    const next = state.queue.shift()
    if (next) {
      // Hand the slot directly to the next waiter (running count stays the same)
      next()
    } else {
      state.running--
    }
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    await this.acquire()
    try {
      return await this.inner.chat(messages, options)
    } finally {
      this.release()
    }
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    await this.acquire()
    try {
      yield* this.inner.chatStream(messages, options)
    } finally {
      this.release()
    }
  }

  /** Reset shared state (useful for tests) */
  static reset(): void {
    ConcurrencyLimiter.shared.clear()
  }
}
