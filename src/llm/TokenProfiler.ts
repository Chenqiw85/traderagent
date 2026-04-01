// src/llm/TokenProfiler.ts
// Wraps any ILLMProvider to intercept and log token usage per call.
// Does NOT modify any existing functions — purely additive instrumentation.

import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'

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

export class TokenProfiler implements ILLMProvider {
  readonly name: string
  private inner: ILLMProvider
  private agentName: string

  private static records: CallRecord[] = []

  constructor(inner: ILLMProvider, agentName: string) {
    this.inner = inner
    this.name = inner.name
    this.agentName = agentName
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const systemMsg = messages.filter((m) => m.role === 'system')
    const userMsg = messages.filter((m) => m.role === 'user')

    const systemChars = systemMsg.reduce((sum, m) => sum + m.content.length, 0)
    const userChars = userMsg.reduce((sum, m) => sum + m.content.length, 0)
    const totalInputChars = messages.reduce((sum, m) => sum + m.content.length, 0)

    const systemTokens = estimateTokens(systemMsg.map((m) => m.content).join(''))
    const userTokens = estimateTokens(userMsg.map((m) => m.content).join(''))
    const totalInputTokens = estimateTokens(messages.map((m) => m.content).join(''))

    console.log(`\n${'─'.repeat(60)}`)
    console.log(`📊 TOKEN PROFILE: ${this.agentName} (model: ${this.inner.name})`)
    console.log(`${'─'.repeat(60)}`)
    console.log(`  System prompt:  ${systemChars.toLocaleString()} chars  ≈ ${systemTokens.toLocaleString()} tokens`)
    console.log(`  User message:   ${userChars.toLocaleString()} chars  ≈ ${userTokens.toLocaleString()} tokens`)
    console.log(`  Total input:    ${totalInputChars.toLocaleString()} chars  ≈ ${totalInputTokens.toLocaleString()} tokens`)

    // Log breakdown of system prompt sections
    for (const msg of systemMsg) {
      const sections = msg.content.split(/(?=={3,}\s)/g)
      if (sections.length > 1) {
        console.log(`  ── System prompt breakdown:`)
        for (const section of sections) {
          const firstLine = section.split('\n')[0].trim().slice(0, 60)
          const chars = section.length
          const tokens = estimateTokens(section)
          console.log(`     ${firstLine.padEnd(50)} ${chars.toLocaleString().padStart(8)} chars  ≈ ${tokens.toLocaleString().padStart(6)} tokens`)
        }
      }
    }

    const start = performance.now()
    const response = await this.inner.chat(messages, options)
    const durationMs = performance.now() - start

    const outputChars = response.length
    const outputTokens = estimateTokens(response)

    console.log(`  Output:         ${outputChars.toLocaleString()} chars  ≈ ${outputTokens.toLocaleString()} tokens`)
    console.log(`  Duration:       ${(durationMs / 1000).toFixed(1)}s`)
    console.log(`${'─'.repeat(60)}`)

    TokenProfiler.records.push({
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
  static printSummary(): void {
    const records = TokenProfiler.records
    if (records.length === 0) return

    console.log(`\n${'═'.repeat(80)}`)
    console.log(`TOKEN USAGE SUMMARY — ALL LLM CALLS`)
    console.log(`${'═'.repeat(80)}`)
    console.log(
      `${'Agent'.padEnd(22)} ${'Sys Tok'.padStart(8)} ${'Usr Tok'.padStart(8)} ${'In Tok'.padStart(8)} ${'Out Tok'.padStart(8)} ${'Total'.padStart(8)} ${'Time'.padStart(6)}`
    )
    console.log(`${'─'.repeat(80)}`)

    let grandInputTokens = 0
    let grandOutputTokens = 0
    let grandDuration = 0

    for (const r of records) {
      const total = r.totalInputTokens + r.outputTokens
      grandInputTokens += r.totalInputTokens
      grandOutputTokens += r.outputTokens
      grandDuration += r.durationMs
      console.log(
        `${r.agent.padEnd(22)} ${r.systemTokens.toLocaleString().padStart(8)} ${r.userTokens.toLocaleString().padStart(8)} ${r.totalInputTokens.toLocaleString().padStart(8)} ${r.outputTokens.toLocaleString().padStart(8)} ${total.toLocaleString().padStart(8)} ${(r.durationMs / 1000).toFixed(1).padStart(5)}s`
      )
    }

    const grandTotal = grandInputTokens + grandOutputTokens
    console.log(`${'─'.repeat(80)}`)
    console.log(
      `${'TOTAL'.padEnd(22)} ${''.padStart(8)} ${''.padStart(8)} ${grandInputTokens.toLocaleString().padStart(8)} ${grandOutputTokens.toLocaleString().padStart(8)} ${grandTotal.toLocaleString().padStart(8)} ${(grandDuration / 1000).toFixed(1).padStart(5)}s`
    )
    console.log(`${'═'.repeat(80)}`)

    // Warn if any single call exceeded common limits
    for (const r of records) {
      if (r.totalInputTokens > 30_000) {
        console.log(`\n⚠️  WARNING: ${r.agent} used ~${r.totalInputTokens.toLocaleString()} input tokens — close to or exceeding model limits!`)
        console.log(`   System prompt: ${r.systemContentLength.toLocaleString()} chars (${r.systemTokens.toLocaleString()} tokens)`)
      }
    }
  }

  /** Reset records between runs */
  static reset(): void {
    TokenProfiler.records = []
  }
}
