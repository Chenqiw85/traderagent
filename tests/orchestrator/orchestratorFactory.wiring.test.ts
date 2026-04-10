import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PIPELINE_CONFIG } from '../../src/config/config.js'
import type { ILLMProvider } from '../../src/llm/ILLMProvider.js'
import type { ILiveMarketDataSource } from '../../src/data/ILiveMarketDataSource.js'

const { orchestratorConfigMock } = vi.hoisted(() => ({
  orchestratorConfigMock: vi.fn(),
}))

vi.mock('../../src/orchestrator/Orchestrator.js', () => ({
  Orchestrator: vi.fn().mockImplementation((config) => {
    orchestratorConfigMock(config)
    return { config }
  }),
}))

const { buildOrchestrator } = await import('../../src/orchestrator/OrchestratorFactory.js')

function makeLlm(name: string): ILLMProvider {
  return {
    name,
    chat: vi.fn(),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function makeLLMs() {
  return {
    bull: makeLlm('bull'),
    bear: makeLlm('bear'),
    news: makeLlm('news'),
    fundamentals: makeLlm('fundamentals'),
    tradePlanner: makeLlm('tradePlanner'),
    riskAnalyst: makeLlm('riskAnalyst'),
    riskManager: makeLlm('riskManager'),
    manager: makeLlm('manager'),
    researchManager: makeLlm('researchManager'),
    portfolioManager: makeLlm('portfolioManager'),
  }
}

describe('buildOrchestrator wiring', () => {
  it('creates a realtimeQuoteFetcher when a live market data source is supplied', () => {
    const liveMarketDataSource: ILiveMarketDataSource = {
      name: 'live-market-chain',
      fetchLiveSnapshot: vi.fn(),
    }

    const orchestrator = buildOrchestrator({
      llms: makeLLMs(),
      pipelineConfig: {
        ...DEFAULT_PIPELINE_CONFIG,
        enabledAnalysts: [],
        debateEnabled: false,
        riskDebateEnabled: false,
      },
      liveMarketDataSource,
    }) as unknown as { config: Record<string, unknown> }

    expect(orchestratorConfigMock).toHaveBeenCalledTimes(1)
    const config = orchestratorConfigMock.mock.calls[0]?.[0] as {
      realtimeQuoteFetcher?: { name: string; role: string }
      dataFetcher?: unknown
      technicalAnalyzer?: unknown
      manager?: { name: string }
    }

    expect(config.realtimeQuoteFetcher).toMatchObject({
      name: 'realtimeQuoteFetcher',
      role: 'data',
    })
    expect(config.dataFetcher).toBeUndefined()
    expect(config.technicalAnalyzer).toBeUndefined()
    expect(config.manager).toMatchObject({ name: 'manager' })
    expect(orchestrator).toMatchObject({
      config: expect.objectContaining({
        realtimeQuoteFetcher: expect.objectContaining({ name: 'realtimeQuoteFetcher' }),
      }),
    })
  })
})
