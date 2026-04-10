import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => {
  const liveMarketSource = { name: 'live-market-chain' }
  const fallbackDataSource = { name: 'price-chain' }
  const orchestrator = { id: 'orchestrator-stub' }
  const report = {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date('2026-04-08T20:00:00.000Z'),
    rawData: [],
    researchFindings: [],
    analysisArtifacts: [],
  }

  return {
    mocks: {
      liveMarketSource,
      fallbackDataSource,
      orchestrator,
      report,
      buildDataSourceChain: vi.fn(() => fallbackDataSource),
      buildLiveMarketSourceChain: vi.fn(() => liveMarketSource),
      buildRAGDeps: vi.fn(() => ({ ragMode: 'disabled', vectorStore: undefined, embedder: undefined })),
      buildOrchestrator: vi.fn(() => orchestrator),
      resolveLLMMap: vi.fn(() => ({ default: true })),
      runTicker: vi.fn().mockResolvedValue(report),
      formatConsoleAnalysisOutput: vi.fn(() => 'formatted-analysis'),
      saveAnalysisReport: vi.fn(() => '/tmp/report.md'),
      loggerInfo: vi.fn(),
      loggerError: vi.fn(),
      fullAnalysisRunnerConfig: vi.fn(),
      llmRegistryGet: vi.fn((agent: string) => ({ name: agent, chat: vi.fn(), chatStream: vi.fn() })),
    },
  }
})

vi.mock('../src/cli/bootstrap.js', () => ({
  buildDataSourceChain: mocks.buildDataSourceChain,
  buildLiveMarketSourceChain: mocks.buildLiveMarketSourceChain,
  buildRAGDeps: mocks.buildRAGDeps,
}))

vi.mock('../src/orchestrator/OrchestratorFactory.js', () => ({
  buildOrchestrator: mocks.buildOrchestrator,
  resolveLLMMap: mocks.resolveLLMMap,
}))

vi.mock('../src/llm/registry.js', () => ({
  LLMRegistry: vi.fn().mockImplementation(() => ({
    get: mocks.llmRegistryGet,
  })),
}))

vi.mock('../src/llm/TokenProfiler.js', () => ({
  TokenProfiler: Object.assign(
    vi.fn().mockImplementation((inner, agent) => ({
      name: inner.name,
      chat: inner.chat,
      chatStream: inner.chatStream,
      agent,
    })),
    {
      printSummary: mocks.loggerInfo,
      reset: vi.fn(),
    },
  ),
}))

vi.mock('../src/llm/withRetry.js', () => ({
  RetryLLMProvider: vi.fn().mockImplementation((inner) => inner),
}))

vi.mock('../src/analysis/FullAnalysisRunner.js', () => ({
  FullAnalysisRunner: vi.fn().mockImplementation((config) => {
    mocks.fullAnalysisRunnerConfig(config)
    return {
      runTicker: mocks.runTicker,
    }
  }),
}))

vi.mock('../src/reports/AnalysisReport.js', () => ({
  formatConsoleAnalysisOutput: mocks.formatConsoleAnalysisOutput,
  saveAnalysisReport: mocks.saveAnalysisReport,
}))

vi.mock('../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: mocks.loggerInfo,
    error: mocks.loggerError,
  }),
}))

const originalArgv = [...process.argv]

describe('run entrypoint wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.argv = ['node', 'src/run.ts', 'AAPL', 'US']
    delete process.env['DATABASE_URL']
  })

  afterEach(() => {
    process.argv = [...originalArgv]
    vi.restoreAllMocks()
  })

  it('passes the live market source chain into buildOrchestrator', async () => {
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`)
    }) as never)

    await import('../src/run.js')

    expect(mocks.buildDataSourceChain).toHaveBeenCalledWith('price-chain')
    expect(mocks.buildLiveMarketSourceChain).toHaveBeenCalledWith('live-market-chain')
    expect(mocks.buildOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSource: mocks.fallbackDataSource,
        spyDataSource: mocks.fallbackDataSource,
        liveMarketDataSource: mocks.liveMarketSource,
      }),
    )
    expect(mocks.fullAnalysisRunnerConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        orchestrator: mocks.orchestrator,
      }),
    )
  })
})
