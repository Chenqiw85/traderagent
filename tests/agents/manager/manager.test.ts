// tests/agents/manager/manager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Manager } from '../../../src/agents/manager/Manager.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'
import type { IVectorStore } from '../../../src/rag/IVectorStore.js'
import type { IEmbedder } from '../../../src/rag/IEmbedder.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function fullReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: ['Strong earnings'], confidence: 0.8 },
      { agentName: 'bearResearcher', stance: 'bear', evidence: ['High valuation'], confidence: 0.6 },
    ],
    researchThesis: {
      stance: 'bull',
      confidence: 0.71,
      summary: 'Uptrend and earnings revisions still support upside.',
      keyDrivers: ['Strong earnings', 'Price above 50DMA'],
      keyRisks: ['High valuation'],
      invalidationConditions: ['Break below 50DMA'],
      timeHorizon: 'swing',
    },
    traderProposal: {
      action: 'OVERWEIGHT',
      confidence: 0.69,
      summary: 'Add only on continuation above resistance with defined downside.',
      entryLogic: 'Add above 182 after confirmation.',
      whyNow: 'Trend strength and thesis are aligned.',
      timeHorizon: 'swing',
      positionSizeFraction: 0.04,
      stopLoss: 145.00,
      takeProfit: 165.00,
      invalidationConditions: ['Lose momentum support'],
    },
    riskAssessment: {
      riskLevel: 'medium',
      metrics: { VaR: 0.03, volatility: 0.22, beta: 1.1, maxDrawdown: 0.15 },
      maxPositionSize: 0.05,
      stopLoss: 145.00,
      takeProfit: 165.00,
    },
    riskVerdict: {
      approved: true,
      summary: 'Risk is acceptable if sizing stays disciplined.',
      blockers: [],
      requiredAdjustments: ['Respect max size'],
    },
    analysisArtifacts: [],
  }
}

function mockVectorStore(): IVectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
  }
}

function mockTextSearchVectorStore(): IVectorStore & { searchText: ReturnType<typeof vi.fn> } {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    searchText: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
  }
}

function mockEmbedder(): IEmbedder {
  return {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  }
}

describe('Manager', () => {
  it('has correct name and role', () => {
    const agent = new Manager({ llm: mockLLM('{}') })
    expect(agent.name).toBe('manager')
    expect(agent.role).toBe('manager')
  })

  it('sets finalDecision on the report', async () => {
    const llm = mockLLM(
      '{"action":"BUY","confidence":0.73,"reasoning":"Bull evidence outweighs bear evidence","suggestedPositionSize":0.04,"stopLoss":145.00,"takeProfit":165.00}'
    )
    const agent = new Manager({ llm })
    const result = await agent.run(fullReport())
    expect(result.finalDecision).toBeDefined()
    expect(result.finalDecision?.action).toBe('BUY')
    expect(result.finalDecision?.confidence).toBe(0.73)
    expect(result.finalDecision?.reasoning).toBe('Bull evidence outweighs bear evidence')
    expect(result.analysisArtifacts?.at(-1)).toEqual({
      stage: 'final',
      agent: 'manager',
      summary: 'Bull evidence outweighs bear evidence',
      payload: result.finalDecision,
    })
  })

  it('falls back to HOLD with confidence 0 on malformed response', async () => {
    const agent = new Manager({ llm: mockLLM('not json') })
    const result = await agent.run(fullReport())
    expect(result.finalDecision?.action).toBe('HOLD')
    expect(result.finalDecision?.confidence).toBe(0)
  })

  it('rejects scalar JSON roots when parsing the final decision', async () => {
    const agent = new Manager({ llm: mockLLM('7') })

    const result = await agent.run(fullReport())

    expect(result.finalDecision).toEqual({
      action: 'HOLD',
      confidence: 0,
      reasoning: 'Manager was unable to parse LLM response',
    })
  })

  it('runtime-validates wrong-type decision payload fields', async () => {
    const agent = new Manager({
      llm: mockLLM(
        '{"action":"BUY","confidence":"0.9","reasoning":42,"suggestedPositionSize":1.2,"stopLoss":-5,"takeProfit":0}'
      ),
    })

    const result = await agent.run(fullReport())

    expect(result.finalDecision).toEqual({
      action: 'BUY',
      confidence: 0.5,
      reasoning: 'Unable to parse manager response',
      suggestedPositionSize: undefined,
      stopLoss: undefined,
      takeProfit: undefined,
    })
  })

  it('includes thesis, trader proposal, and risk verdict in the LLM context', async () => {
    const llm = mockLLM('{"action":"SELL","confidence":0.65,"reasoning":"Risk too high"}')
    const agent = new Manager({ llm })
    await agent.run(fullReport())
    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(messages[0].content).toContain('Research Thesis')
    expect(messages[0].content).toContain('Uptrend and earnings revisions still support upside.')
    expect(messages[0].content).toContain('Trader Proposal')
    expect(messages[0].content).toContain('Add only on continuation above resistance with defined downside.')
    expect(messages[0].content).toContain('Risk Verdict')
    expect(messages[0].content).toContain('Risk is acceptable if sizing stays disciplined.')
    expect(messages[0].content).toContain('bullResearcher')
    expect(messages[0].content).toContain('medium')
  })

  it('coerces bullish LLM output to HOLD when the risk gate rejects the proposal', async () => {
    const llm = mockLLM(
      '{"action":"BUY","confidence":0.82,"reasoning":"Momentum is strong","suggestedPositionSize":0.05,"stopLoss":145,"takeProfit":170}'
    )
    const agent = new Manager({ llm })
    const report = fullReport()
    report.riskVerdict = {
      approved: false,
      summary: 'Risk gate rejected the setup due to gap risk.',
      blockers: ['Gap risk too high'],
      requiredAdjustments: ['Wait for volatility compression'],
    }

    const result = await agent.run(report)

    expect(result.finalDecision?.action).toBe('HOLD')
    expect(result.finalDecision?.confidence).toBeLessThan(0.82)
    expect(result.finalDecision?.suggestedPositionSize).toBe(0)
    expect(result.finalDecision?.stopLoss).toBeUndefined()
    expect(result.finalDecision?.takeProfit).toBeUndefined()
    expect(result.finalDecision?.reasoning).toContain('Risk gate rejected the setup due to gap risk.')
    expect(result.finalDecision?.reasoning).toContain('non-HOLD action was overridden')
  })

  it('coerces bearish LLM output to HOLD when the risk gate rejects the proposal', async () => {
    const llm = mockLLM(
      '{"action":"SELL","confidence":0.77,"reasoning":"Downside momentum is accelerating","suggestedPositionSize":0.05}'
    )
    const agent = new Manager({ llm })
    const report = fullReport()
    report.riskVerdict = {
      approved: false,
      summary: 'Risk gate rejected the setup due to event risk.',
      blockers: ['Headline risk is too elevated'],
      requiredAdjustments: ['Wait until after the catalyst'],
    }

    const result = await agent.run(report)

    expect(result.finalDecision?.action).toBe('HOLD')
    expect(result.finalDecision?.confidence).toBeLessThan(0.77)
    expect(result.finalDecision?.suggestedPositionSize).toBe(0)
    expect(result.finalDecision?.stopLoss).toBeUndefined()
    expect(result.finalDecision?.takeProfit).toBeUndefined()
    expect(result.finalDecision?.reasoning).toContain('Risk gate rejected the setup due to event risk.')
    expect(result.finalDecision?.reasoning).toContain('overridden to HOLD')
  })

  it('scopes lesson retrieval by ticker and market', async () => {
    const llm = mockLLM('{"action":"HOLD","confidence":0.5,"reasoning":"test"}')
    const vs = mockVectorStore()
    const embedder = mockEmbedder()
    const agent = new Manager({ llm, vectorStore: vs, embedder })

    await agent.run(fullReport())

    expect(vs.search).toHaveBeenCalledWith(
      expect.any(Array),
      3,
      { must: [{ ticker: 'AAPL' }, { market: 'US' }, { type: 'lesson' }] },
    )
  })

  it('uses setup-aware lesson retrieval with text search', async () => {
    const llm = mockLLM('{"action":"HOLD","confidence":0.5,"reasoning":"test"}')
    const vs = mockTextSearchVectorStore()
    const agent = new Manager({ llm, vectorStore: vs })

    await agent.run(fullReport())

    expect(vs.searchText).toHaveBeenCalledWith(
      expect.stringContaining('trading decision lessons'),
      3,
      { must: [{ ticker: 'AAPL' }, { market: 'US' }, { type: 'lesson' }] },
    )
    expect(vs.searchText).toHaveBeenCalledWith(
      expect.stringContaining('bullish setup'),
      3,
      { must: [{ ticker: 'AAPL' }, { market: 'US' }, { type: 'lesson' }] },
    )
  })
})
