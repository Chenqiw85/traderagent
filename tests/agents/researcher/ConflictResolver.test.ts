import { describe, it, expect, vi } from 'vitest'
import { ConflictResolver } from '../../../src/agents/researcher/ConflictResolver.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { Conflict } from '../../../src/types/quality.js'
import type { ComputedIndicators } from '../../../src/agents/base/types.js'

function makeLLM(response: string): ILLMProvider {
  return { name: 'mock', chat: vi.fn().mockResolvedValue(response), chatStream: vi.fn() }
}

const indicators: ComputedIndicators = {
  trend: { sma50: 170, sma200: 160, ema12: 175, ema26: 170, macd: { line: 5, signal: 3, histogram: 2 } },
  momentum: { rsi: 55, stochastic: { k: 60, d: 55 } },
  volatility: { bollingerUpper: 185, bollingerMiddle: 175, bollingerLower: 165, atr: 3.5, historicalVolatility: 0.25 },
  volume: { obv: 1000000 },
  risk: { beta: 1.1, maxDrawdown: 0.12, var95: 0.02 },
  fundamentals: { pe: 25, pb: 3.5, dividendYield: 0.015, eps: 6.5 },
}

describe('ConflictResolver', () => {
  it('resolves conflict with a winner', async () => {
    const llm = makeLLM(JSON.stringify({ winner: 'bear', reasoning: 'P/E of 25 is above both sector median of 22 and market median of 18', adjustedConfidence: { bull: 0.4, bear: 0.8 } }))
    const resolver = new ConflictResolver({ llm })
    const conflict: Conflict = { metric: 'P/E', bullClaim: 'P/E of 25 is reasonable for tech sector', bearClaim: 'P/E of 25 is extreme vs market average', isContradiction: true, severity: 'high' }
    const resolution = await resolver.resolve(conflict, indicators)
    expect(resolution.winner).toBe('bear')
    expect(resolution.adjustedConfidence.bull).toBe(0.4)
    expect(resolution.adjustedConfidence.bear).toBe(0.8)
  })

  it('marks both_valid when LLM determines compatible framings', async () => {
    const llm = makeLLM(JSON.stringify({ winner: 'both_valid', reasoning: 'Both framings are valid perspectives', adjustedConfidence: { bull: 0.7, bear: 0.7 } }))
    const resolver = new ConflictResolver({ llm })
    const conflict: Conflict = { metric: 'RSI', bullClaim: 'RSI at 55 is neutral-to-bullish', bearClaim: 'RSI at 55 shows limited upside momentum', isContradiction: false, severity: 'low' }
    const resolution = await resolver.resolve(conflict, indicators)
    expect(resolution.winner).toBe('both_valid')
  })

  it('skips low severity conflicts', async () => {
    const resolver = new ConflictResolver({ llm: makeLLM('') })
    const conflicts: Conflict[] = [
      { metric: 'P/E', bullClaim: 'a', bearClaim: 'b', isContradiction: true, severity: 'high' },
      { metric: 'RSI', bullClaim: 'c', bearClaim: 'd', isContradiction: false, severity: 'low' },
    ]
    const toResolve = resolver.filterForResolution(conflicts)
    expect(toResolve).toHaveLength(1)
    expect(toResolve[0].metric).toBe('P/E')
  })

  it('handles LLM parse failure gracefully', async () => {
    const resolver = new ConflictResolver({ llm: makeLLM('not valid json') })
    const conflict: Conflict = { metric: 'P/E', bullClaim: 'a', bearClaim: 'b', isContradiction: true, severity: 'high' }
    const resolution = await resolver.resolve(conflict, indicators)
    expect(resolution.winner).toBe('both_valid')
    expect(resolution.reasoning).toContain('parse')
  })
})
