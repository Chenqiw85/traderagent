// src/llm/TokenProfiler.ts
// Wraps any ILLMProvider to intercept and log token usage per call.
// Does NOT modify any existing functions — purely additive instrumentation.

import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('token-profiler')

type CallRecord = {
  agent: string
  model: string
  systemTokens: number
  userTokens: number
  totalInputTokens: number
  outputTokens: number
  systemContentLength: number
  userContentLength: number
  totalInputChars: number
  outputChars: number
  durationMs: number
}

/** Rough token estimate: ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const isDebug = process.env['DEBUG'] === '1' || process.env['DEBUG'] === 'true'

export class TokenProfiler implements ILLMProvider {
  readonly name: string
  private inner: ILLMProvider
  private agentName: string
  private records: CallRecord[]

  constructor(inner: ILLMProvider, agentName: string, records?: CallRecord[]) {
    this.inner = inner
    this.name = inner.name
    this.agentName = agentName
    this.records = records ?? TokenProfiler.sharedRecords
  }

  private static sharedRecords: CallRecord[] = []

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const systemMsg = messages.filter((m) => m.role === 'system')
    const userMsg = messages.filter((m) => m.role === 'user')

    const systemChars = systemMsg.reduce((sum, m) => sum + m.content.length, 0)
    const userChars = userMsg.reduce((sum, m) => sum + m.content.length, 0)
    const totalInputChars = messages.reduce((sum, m) => sum + m.content.length, 0)

    const systemTokens = estimateTokens(systemMsg.map((m) => m.content).join(''))
    const userTokens = estimateTokens(userMsg.map((m) => m.content).join(''))
    const totalInputTokens = estimateTokens(messages.map((m) => m.content).join(''))

    if (isDebug) {
      log.debug({ agent: this.agentName, chars: totalInputChars, tokens: totalInputTokens }, 'LLM input')
    }

    const start = performance.now()
    const response = await this.inner.chat(messages, options)
    const durationMs = performance.now() - start

    const outputChars = response.length
    const outputTokens = estimateTokens(response)

    if (isDebug) {
      log.debug({ agent: this.agentName, chars: outputChars, tokens: outputTokens, durationMs }, 'LLM output')
    }

    this.records.push({
      agent: this.agentName,
      model: this.inner.name,
      systemTokens,
      userTokens,
      totalInputTokens,
      outputTokens,
      systemContentLength: systemChars,
      userContentLength: userChars,
      totalInputChars,
      outputChars,
      durationMs,
    })

    return response
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    // Pass-through for streaming — profiling chat() is sufficient
    yield* this.inner.chatStream(messages, options)
  }

  /** Print a full summary table of all LLM calls in the pipeline */
  static printSummary(records?: CallRecord[]): void {
    const recs = records ?? TokenProfiler.sharedRecords
    if (recs.length === 0) return

    const header = `\n${'═'.repeat(80)}\nTOKEN USAGE SUMMARY — ALL LLM CALLS\n${'═'.repeat(80)}`
    const colHeader = `${'Agent'.padEnd(22)} ${'Sys Tok'.padStart(8)} ${'Usr Tok'.padStart(8)} ${'In Tok'.padStart(8)} ${'Out Tok'.padStart(8)} ${'Total'.padStart(8)} ${'Time'.padStart(6)}`
    const separator = `${'─'.repeat(80)}`

    const lines = [header, colHeader, separator]

    let grandInputTokens = 0
    let grandOutputTokens = 0
    let grandDuration = 0

    for (const r of recs) {
      const total = r.totalInputTokens + r.outputTokens
      grandInputTokens += r.totalInputTokens
      grandOutputTokens += r.outputTokens
      grandDuration += r.durationMs
      lines.push(
        `${r.agent.padEnd(22)} ${r.systemTokens.toLocaleString().padStart(8)} ${r.userTokens.toLocaleString().padStart(8)} ${r.totalInputTokens.toLocaleString().padStart(8)} ${r.outputTokens.toLocaleString().padStart(8)} ${total.toLocaleString().padStart(8)} ${(r.durationMs / 1000).toFixed(1).padStart(5)}s`
      )
    }

    const grandTotal = grandInputTokens + grandOutputTokens
    lines.push(separator)
    lines.push(
      `${'TOTAL'.padEnd(22)} ${''.padStart(8)} ${''.padStart(8)} ${grandInputTokens.toLocaleString().padStart(8)} ${grandOutputTokens.toLocaleString().padStart(8)} ${grandTotal.toLocaleString().padStart(8)} ${(grandDuration / 1000).toFixed(1).padStart(5)}s`
    )
    lines.push(`${'═'.repeat(80)}`)

    log.info(lines.join('\n'))

    // Warn if any single call exceeded common limits
    for (const r of recs) {
      if (r.totalInputTokens > 30_000) {
        log.warn({ agent: r.agent, inputTokens: r.totalInputTokens, systemChars: r.systemContentLength }, 'Input tokens close to or exceeding model limits')
      }
    }
  }

  /** Reset shared records between runs */
  static reset(): void {
    TokenProfiler.sharedRecords = []
  }
}
