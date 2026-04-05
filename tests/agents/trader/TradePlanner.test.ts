import { describe, expect, it, vi } from 'vitest'
import { TradePlanner } from '../../../src/agents/trader/TradePlanner.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function reportWithThesis(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-05T10:00:00Z'),
    rawData: [
      {
        ticker: 'AAPL',
        market: 'US',
        type: 'ohlcv',
        data: [
          { date: '2026-04-03', open: 178, high: 181, low: 177, close: 180, volume: 1_200_000 },
          { date: '2026-04-04', open: 180, high: 183, low: 179, close: 182, volume: 1_350_000 },
        ],
        fetchedAt: new Date('2026-04-05T09:59:00Z'),
      },
    ],
    computedIndicators: {
      trend: {
        sma50: 176,
        sma200: 162,
        ema12: 180.2,
        ema26: 177.4,
        macd: { line: 2.8, signal: 2.1, histogram: 0.7 },
      },
      momentum: {
        rsi: 63.4,
        stochastic: { k: 71.2, d: 66.8 },
      },
      volatility: {
        bollingerUpper: 186,
        bollingerMiddle: 178,
        bollingerLower: 170,
        atr: 4.3,
        historicalVolatility: 0.24,
      },
      volume: {
        obv: 8_500_000,
      },
      risk: {
        beta: 1.08,
        maxDrawdown: 0.14,
        var95: 0.027,
      },
      fundamentals: {
        pe: 27,
        pb: 11,
        dividendYield: 0.004,
        eps: 6.8,
      },
    },
    researchFindings: [
      {
        agentName: 'bullResearcher',
        stance: 'bull',
        evidence: ['Earnings revisions remain positive', 'Price closed above resistance'],
        confidence: 0.78,
      },
    ],
    researchThesis: {
      stance: 'bull',
      confidence: 0.72,
      summary: 'Momentum and earnings revisions support upside.',
      keyDrivers: ['Earnings revisions', 'Trend strength'],
      keyRisks: ['Valuation'],
      invalidationConditions: ['Break below 50DMA'],
      timeHorizon: 'swing',
    },
    analysisArtifacts: [],
  }
}

describe('TradePlanner', () => {
  it('creates a structured traderProposal and appends a trade artifact', async () => {
    const agent = new TradePlanner({
      llm: mockLLM(
        JSON.stringify({
          action: 'OVERWEIGHT',
          confidence: 0.68,
          summary: 'Scale into strength while honoring a tight invalidation.',
          entryLogic: 'Add on confirmation above prior day high.',
          whyNow: 'Trend and revisions are aligned now.',
          timeHorizon: 'swing',
          positionSizeFraction: 0.06,
          stopLoss: 182,
          takeProfit: 205,
          invalidationConditions: ['Close below 50DMA'],
        }),
      ),
    })

    const result = await agent.run(reportWithThesis())

    expect(result.traderProposal).toEqual({
      action: 'OVERWEIGHT',
      confidence: 0.68,
      summary: 'Scale into strength while honoring a tight invalidation.',
      entryLogic: 'Add on confirmation above prior day high.',
      whyNow: 'Trend and revisions are aligned now.',
      timeHorizon: 'swing',
      positionSizeFraction: 0.06,
      stopLoss: 182,
      takeProfit: 205,
      invalidationConditions: ['Close below 50DMA'],
    })
    expect(result.analysisArtifacts).toHaveLength(1)
    expect(result.analysisArtifacts?.[0]).toEqual({
      stage: 'trade',
      agent: 'tradePlanner',
      summary: 'Scale into strength while honoring a tight invalidation.',
      payload: result.traderProposal,
    })
  })

  it('throws when researchThesis is missing', async () => {
    const agent = new TradePlanner({ llm: mockLLM('{}') })
    const report: TradingReport = {
      ticker: 'AAPL',
      market: 'US',
      timestamp: new Date('2026-04-05T10:00:00Z'),
      rawData: [],
      researchFindings: [],
      analysisArtifacts: [],
    }

    await expect(agent.run(report)).rejects.toThrow('TradePlanner: cannot plan without researchThesis')
  })

  it('passes grounded market context to the LLM in addition to the thesis', async () => {
    const llm = mockLLM(
      JSON.stringify({
        action: 'BUY',
        confidence: 0.7,
        summary: 'Grounded trade plan.',
        entryLogic: 'Buy strength.',
        whyNow: 'Setup confirmed.',
        timeHorizon: 'swing',
        invalidationConditions: ['Break support'],
      }),
    )
    const agent = new TradePlanner({ llm })

    await agent.run(reportWithThesis())

    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const combinedPrompt = messages.map((message: { content: string }) => message.content).join('\n')

    expect(combinedPrompt).toContain('Momentum and earnings revisions support upside.')
    expect(combinedPrompt).toContain('Latest market context')
    expect(combinedPrompt).toContain('RSI=63.4')
    expect(combinedPrompt).toContain('close=182.00')
  })

  it('drops out-of-range numeric proposal fields from the LLM payload', async () => {
    const agent = new TradePlanner({
      llm: mockLLM(
        JSON.stringify({
          action: 'BUY',
          confidence: 0.7,
          summary: 'Numeric fields should be sanitized.',
          entryLogic: 'Buy a breakout.',
          whyNow: 'Trend confirmed.',
          timeHorizon: 'swing',
          positionSizeFraction: 1.4,
          stopLoss: -182,
          takeProfit: 0,
          invalidationConditions: ['Lose support'],
        }),
      ),
    })

    const result = await agent.run(reportWithThesis())

    expect(result.traderProposal).toEqual({
      action: 'BUY',
      confidence: 0.7,
      summary: 'Numeric fields should be sanitized.',
      entryLogic: 'Buy a breakout.',
      whyNow: 'Trend confirmed.',
      timeHorizon: 'swing',
      positionSizeFraction: undefined,
      stopLoss: undefined,
      takeProfit: undefined,
      invalidationConditions: ['Lose support'],
    })
  })
})
