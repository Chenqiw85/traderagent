import { describe, expect, it, vi } from 'vitest'
import { ResearchManager } from '../../../src/agents/researcher/ResearchManager.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function reportWithFindings(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-05T10:00:00Z'),
    rawData: [],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: ['Revenue re-acceleration'], confidence: 0.8 },
      { agentName: 'bearResearcher', stance: 'bear', evidence: ['Rich valuation'], confidence: 0.55 },
    ],
    analysisArtifacts: [],
  }
}

function emptyReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-05T10:00:00Z'),
    rawData: [],
    researchFindings: [],
    analysisArtifacts: [],
  }
}

describe('ResearchManager', () => {
  it('writes a structured researchThesis with parsed fields', async () => {
    const llm = mockLLM(
      JSON.stringify({
        stance: 'bull',
        confidence: 0.74,
        summary: 'Bull case wins on earnings momentum and improving breadth.',
        keyDrivers: ['Revenue re-acceleration', 'Supportive price structure'],
        keyRisks: ['Premium valuation'],
        invalidationConditions: ['RSI rolls over below 45', 'Forward guidance misses'],
        timeHorizon: 'swing',
      })
    )

    const agent = new ResearchManager({ llm })
    const result = await agent.run(reportWithFindings())

    expect(result.researchThesis).toEqual({
      stance: 'bull',
      confidence: 0.74,
      summary: 'Bull case wins on earnings momentum and improving breadth.',
      keyDrivers: ['Revenue re-acceleration', 'Supportive price structure'],
      keyRisks: ['Premium valuation'],
      invalidationConditions: ['RSI rolls over below 45', 'Forward guidance misses'],
      timeHorizon: 'swing',
    })
  })

  it('appends a research analysis artifact', async () => {
    const llm = mockLLM(
      JSON.stringify({
        stance: 'bear',
        confidence: 0.41,
        summary: 'Bear case centers on valuation and weakening momentum.',
        keyDrivers: ['Premium valuation'],
        keyRisks: ['Strong balance sheet'],
        invalidationConditions: ['Shares reclaim the 50-day average'],
        timeHorizon: 'short',
      })
    )

    const agent = new ResearchManager({ llm })
    const result = await agent.run(reportWithFindings())

    expect(result.analysisArtifacts).toHaveLength(1)
    expect(result.analysisArtifacts?.[0]).toEqual({
      stage: 'research',
      agent: 'researchManager',
      summary: 'Bear case centers on valuation and weakening momentum.',
      payload: result.researchThesis,
    })
  })

  it('appends a compatibility synthesized finding', async () => {
    const llm = mockLLM(
      JSON.stringify({
        stance: 'bull',
        confidence: 0.9,
        summary: 'Momentum and breadth support the bull case.',
        keyDrivers: ['Revenue re-acceleration', 'Positive revisions', 'Extra driver'],
        keyRisks: ['Rich valuation'],
        invalidationConditions: ['Guidance slips'],
        timeHorizon: 'position',
      })
    )
    const agent = new ResearchManager({ llm })

    const result = await agent.run(reportWithFindings())

    expect(result.researchFindings).toHaveLength(3)
    expect(result.researchFindings[2]).toEqual({
      agentName: 'researchManager',
      stance: 'bull',
      evidence: ['Momentum and breadth support the bull case.', 'Revenue re-acceleration', 'Positive revisions'],
      confidence: 0.9,
      sentiment: 'Momentum and breadth support the bull case.',
    })
  })

  it('falls back to a neutral thesis on malformed LLM output', async () => {
    const agent = new ResearchManager({ llm: mockLLM('not json') })
    const result = await agent.run(reportWithFindings())

    expect(result.researchThesis).toEqual({
      stance: 'neutral',
      confidence: 0,
      summary: '',
      keyDrivers: [],
      keyRisks: [],
      invalidationConditions: [],
      timeHorizon: 'short',
    })
  })

  it('sanitizes malformed-but-valid JSON fields', async () => {
    const llm = mockLLM(
      JSON.stringify({
        stance: 'bull',
        confidence: '0.9',
        summary: '   ',
        keyDrivers: ['  Valid driver  ', '   ', '\tSecond driver\t', 42],
        keyRisks: [null, '  Valid risk  ', ''],
        invalidationConditions: ['  Condition  ', false, '   '],
        timeHorizon: 'monthly',
      })
    )
    const agent = new ResearchManager({ llm })

    const result = await agent.run(reportWithFindings())

    expect(result.researchThesis).toEqual({
      stance: 'bull',
      confidence: 0.5,
      summary: '',
      keyDrivers: ['Valid driver', 'Second driver'],
      keyRisks: ['Valid risk'],
      invalidationConditions: ['Condition'],
      timeHorizon: 'short',
    })
    expect(result.researchFindings[2]).toEqual({
      agentName: 'researchManager',
      stance: 'bull',
      evidence: ['Valid driver', 'Second driver'],
      confidence: 0.5,
      sentiment: '',
    })
  })

  it('falls back when the JSON root is a scalar', async () => {
    const agent = new ResearchManager({ llm: mockLLM('123') })
    const result = await agent.run(reportWithFindings())

    expect(result.researchThesis).toEqual({
      stance: 'neutral',
      confidence: 0,
      summary: '',
      keyDrivers: [],
      keyRisks: [],
      invalidationConditions: [],
      timeHorizon: 'short',
    })
    expect(result.analysisArtifacts?.[0]).toEqual({
      stage: 'research',
      agent: 'researchManager',
      summary: '',
      payload: result.researchThesis,
    })
    expect(result.researchFindings[2]).toEqual({
      agentName: 'researchManager',
      stance: 'neutral',
      evidence: [],
      confidence: 0,
      sentiment: '',
    })
  })

  it('returns the report unchanged and does not call llm.chat when there are no research findings', async () => {
    const llm = mockLLM(
      JSON.stringify({
        stance: 'bull',
        confidence: 1,
        summary: 'unused',
        keyDrivers: [],
        keyRisks: [],
        invalidationConditions: [],
        timeHorizon: 'position',
      })
    )
    const agent = new ResearchManager({ llm })
    const report = emptyReport()

    const result = await agent.run(report)

    expect(result).toBe(report)
    expect(llm.chat).not.toHaveBeenCalled()
  })
})
