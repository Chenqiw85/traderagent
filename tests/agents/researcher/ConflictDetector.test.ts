import { describe, it, expect, vi } from 'vitest'
import { ConflictDetector } from '../../../src/agents/researcher/ConflictDetector.js'
import type { Finding } from '../../../src/agents/base/types.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'

function makeLLM(response: string): ILLMProvider {
  return { name: 'mock', chat: vi.fn().mockResolvedValue(response), chatStream: vi.fn() }
}

describe('ConflictDetector', () => {
  it('extracts overlapping metrics between bull and bear findings', () => {
    const detector = new ConflictDetector({ llm: makeLLM('') })
    const bull: Finding = { agentName: 'bullResearcher', stance: 'bull', evidence: ['P/E of 25 is reasonable for tech sector', 'RSI at 55 shows healthy momentum'], confidence: 0.7 }
    const bear: Finding = { agentName: 'bearResearcher', stance: 'bear', evidence: ['P/E of 25 is extreme vs market average of 18', 'Max drawdown of 15% is concerning'], confidence: 0.8 }
    const overlaps = detector.findMetricOverlaps([bull], [bear])
    expect(overlaps).toHaveLength(1)
    expect(overlaps[0].metric).toContain('P/E')
    expect(overlaps[0].bullClaim).toContain('reasonable')
    expect(overlaps[0].bearClaim).toContain('extreme')
  })

  it('returns empty when no overlapping metrics', () => {
    const detector = new ConflictDetector({ llm: makeLLM('') })
    const bull: Finding = { agentName: 'bullResearcher', stance: 'bull', evidence: ['RSI at 55 shows healthy momentum'], confidence: 0.7 }
    const bear: Finding = { agentName: 'bearResearcher', stance: 'bear', evidence: ['Max drawdown of 15% is concerning'], confidence: 0.8 }
    expect(detector.findMetricOverlaps([bull], [bear])).toHaveLength(0)
  })

  it('detects contradictions via LLM for overlapping metrics', async () => {
    const llm = makeLLM(JSON.stringify({ isContradiction: true, severity: 'high' }))
    const detector = new ConflictDetector({ llm })
    const overlaps = [{ metric: 'P/E', bullClaim: 'P/E of 25 is reasonable for tech sector', bearClaim: 'P/E of 25 is extreme vs market average of 18' }]
    const conflicts = await detector.checkContradictions(overlaps)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].isContradiction).toBe(true)
    expect(conflicts[0].severity).toBe('high')
  })

  it('marks non-contradictions correctly', async () => {
    const llm = makeLLM(JSON.stringify({ isContradiction: false, severity: 'low' }))
    const detector = new ConflictDetector({ llm })
    const overlaps = [{ metric: 'RSI', bullClaim: 'RSI at 55 shows neutral-to-bullish momentum', bearClaim: 'RSI at 55 is not yet oversold, limiting upside' }]
    const conflicts = await detector.checkContradictions(overlaps)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].isContradiction).toBe(false)
  })
})
