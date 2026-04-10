import { describe, it, expect, vi } from 'vitest'
import { EvidenceValidator } from '../../../src/agents/researcher/EvidenceValidator.js'
import type { Finding, TradingReport, ComputedIndicators } from '../../../src/agents/base/types.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'

function makeLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn(),
  }
}

function makeReport(): TradingReport {
  return {
    ticker: 'AAPL', market: 'US', timestamp: new Date('2026-04-08'),
    rawData: [{ ticker: 'AAPL', market: 'US', type: 'fundamentals', data: { pe: 25, pb: 3.5 }, fetchedAt: new Date() }],
    researchFindings: [],
    computedIndicators: {
      trend: { sma50: 170, sma200: 160, ema12: 175, ema26: 170, macd: { line: 5, signal: 3, histogram: 2 } },
      momentum: { rsi: 55, stochastic: { k: 60, d: 55 } },
      volatility: { bollingerUpper: 185, bollingerMiddle: 175, bollingerLower: 165, atr: 3.5, historicalVolatility: 0.25 },
      volume: { obv: 1000000 },
      risk: { beta: 1.1, maxDrawdown: 0.12, var95: 0.02 },
      fundamentals: { pe: 25, pb: 3.5, dividendYield: 0.015, eps: 6.5 },
    } as ComputedIndicators,
  }
}

describe('EvidenceValidator', () => {
  it('rejects finding with invalid schema — missing confidence', () => {
    const validator = new EvidenceValidator({ llm: makeLLM('') })
    const finding = { agentName: 'bullResearcher', stance: 'bull', evidence: ['RSI at 55'] } as unknown as Finding
    const result = validator.validateSchema(finding)
    expect(result.valid).toBe(false)
    expect(result.violations).toContain('missing required field: confidence')
  })

  it('rejects finding with confidence out of range', () => {
    const validator = new EvidenceValidator({ llm: makeLLM('') })
    const finding: Finding = { agentName: 'bullResearcher', stance: 'bull', evidence: ['RSI at 55'], confidence: 1.5 }
    const result = validator.validateSchema(finding)
    expect(result.valid).toBe(false)
    expect(result.violations[0]).toContain('confidence')
  })

  it('rejects finding with invalid stance', () => {
    const validator = new EvidenceValidator({ llm: makeLLM('') })
    const finding = { agentName: 'bullResearcher', stance: 'bullish' as 'bull', evidence: ['RSI at 55'], confidence: 0.7 } as Finding
    const result = validator.validateSchema(finding)
    expect(result.valid).toBe(false)
  })

  it('passes schema validation for valid finding', () => {
    const validator = new EvidenceValidator({ llm: makeLLM('') })
    const finding: Finding = { agentName: 'bullResearcher', stance: 'bull', evidence: ['RSI at 55 suggests neutral momentum'], confidence: 0.7 }
    const result = validator.validateSchema(finding)
    expect(result.valid).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('calls LLM to check evidence grounding and parses result', async () => {
    const llmResponse = JSON.stringify({ valid: true, groundedEvidence: ['RSI at 55 matches computed RSI 55'], ungroundedClaims: [], violations: [] })
    const validator = new EvidenceValidator({ llm: makeLLM(llmResponse) })
    const finding: Finding = { agentName: 'bullResearcher', stance: 'bull', evidence: ['RSI at 55 suggests neutral momentum'], confidence: 0.7 }
    const result = await validator.validate(finding, makeReport())
    expect(result.valid).toBe(true)
    expect(result.groundedEvidence).toContain('RSI at 55 matches computed RSI 55')
  })

  it('returns invalid when LLM finds ungrounded claims', async () => {
    const llmResponse = JSON.stringify({ valid: false, groundedEvidence: [], ungroundedClaims: ['P/E of 12 — actual P/E is 25'], violations: ['Claimed P/E of 12 but computed P/E is 25'] })
    const validator = new EvidenceValidator({ llm: makeLLM(llmResponse) })
    const finding: Finding = { agentName: 'bullResearcher', stance: 'bull', evidence: ['P/E of 12 is attractively valued'], confidence: 0.8 }
    const result = await validator.validate(finding, makeReport())
    expect(result.valid).toBe(false)
    expect(result.ungroundedClaims).toHaveLength(1)
    expect(result.violations).toHaveLength(1)
  })

  it('returns invalid on LLM parse failure', async () => {
    const validator = new EvidenceValidator({ llm: makeLLM('not json') })
    const finding: Finding = { agentName: 'bullResearcher', stance: 'bull', evidence: ['RSI at 55'], confidence: 0.7 }
    const result = await validator.validate(finding, makeReport())
    expect(result.valid).toBe(false)
    expect(result.violations[0]).toContain('parse')
  })
})
