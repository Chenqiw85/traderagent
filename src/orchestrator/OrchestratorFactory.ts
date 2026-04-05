// src/orchestrator/OrchestratorFactory.ts

import type { IAgent } from '../agents/base/IAgent.js'
import type { ILLMProvider } from '../llm/ILLMProvider.js'
import type { IVectorStore } from '../rag/IVectorStore.js'
import type { IEmbedder } from '../rag/IEmbedder.js'
import type { IDataSource } from '../data/IDataSource.js'
import type { AnalystType, PipelineConfig } from '../config/config.js'
import type { TradingReport } from '../agents/base/types.js'
import { Orchestrator } from './Orchestrator.js'
import { BullResearcher } from '../agents/researcher/BullResearcher.js'
import { BearResearcher } from '../agents/researcher/BearResearcher.js'
import { NewsAnalyst } from '../agents/researcher/NewsAnalyst.js'
import { FundamentalsAnalyst } from '../agents/researcher/FundamentalsAnalyst.js'
import { DebateEngine } from '../agents/researcher/DebateEngine.js'
import { ResearchManager } from '../agents/researcher/ResearchManager.js'
import { TradePlanner } from '../agents/trader/TradePlanner.js'
import { RiskAnalyst } from '../agents/risk/RiskAnalyst.js'
import { RiskManager } from '../agents/risk/RiskManager.js'
import { AggressiveRiskAnalyst } from '../agents/risk/AggressiveRiskAnalyst.js'
import { ConservativeRiskAnalyst } from '../agents/risk/ConservativeRiskAnalyst.js'
import { NeutralRiskAnalyst } from '../agents/risk/NeutralRiskAnalyst.js'
import { PortfolioManager } from '../agents/risk/PortfolioManager.js'
import { Manager } from '../agents/manager/Manager.js'
import { DataFetcher } from '../agents/data/DataFetcher.js'
import { TechnicalAnalyzer } from '../agents/analyzer/TechnicalAnalyzer.js'
import { setOutputLanguage } from '../utils/i18n.js'

type LLMMap = {
  bull: ILLMProvider
  bear: ILLMProvider
  news: ILLMProvider
  fundamentals: ILLMProvider
  tradePlanner: ILLMProvider
  riskAnalyst: ILLMProvider
  riskManager: ILLMProvider
  manager: ILLMProvider
  researchManager?: ILLMProvider
  portfolioManager?: ILLMProvider
}

type LLMMapVariant = 'default' | 'trader'

type FactoryDeps = {
  llms: LLMMap
  pipelineConfig: PipelineConfig
  vectorStore?: IVectorStore
  embedder?: IEmbedder
  dataSource?: IDataSource
  spyDataSource?: IDataSource
}

const ANALYST_BUILDERS: Record<AnalystType, (deps: FactoryDeps) => IAgent> = {
  bull: (deps) =>
    new BullResearcher({
      llm: deps.llms.bull,
      vectorStore: deps.vectorStore,
      embedder: deps.embedder,
    }),
  bear: (deps) =>
    new BearResearcher({
      llm: deps.llms.bear,
      vectorStore: deps.vectorStore,
      embedder: deps.embedder,
    }),
  news: (deps) =>
    new NewsAnalyst({
      llm: deps.llms.news,
      vectorStore: deps.vectorStore,
      embedder: deps.embedder,
    }),
  fundamentals: (deps) =>
    new FundamentalsAnalyst({
      llm: deps.llms.fundamentals,
      vectorStore: deps.vectorStore,
      embedder: deps.embedder,
    }),
}

export function resolveLLMMap(
  getProvider: (agentName: string) => ILLMProvider,
  variant: LLMMapVariant,
): LLMMap {
  if (variant === 'trader') {
    return {
      bull: getProvider('traderPipelineBull'),
      bear: getProvider('traderPipelineBear'),
      news: getProvider('traderPipelineNews'),
      fundamentals: getProvider('traderPipelineFundamentals'),
      tradePlanner: getProvider('traderPipelineManager'),
      riskAnalyst: getProvider('traderPipelineRisk'),
      riskManager: getProvider('traderPipelineRiskMgr'),
      manager: getProvider('traderPipelineManager'),
    }
  }

  return {
    bull: getProvider('bullResearcher'),
    bear: getProvider('bearResearcher'),
    news: getProvider('newsAnalyst'),
    fundamentals: getProvider('fundamentalsAnalyst'),
    tradePlanner: getProvider('tradePlanner'),
    riskAnalyst: getProvider('riskAnalyst'),
    riskManager: getProvider('riskManager'),
    manager: getProvider('manager'),
  }
}

/**
 * Builds an Orchestrator wired with all configured features:
 * - Dynamic analyst selection
 * - Bull-Bear debate system
 * - Risk debate system
 * - Output language
 */
export function buildOrchestrator(deps: FactoryDeps): Orchestrator {
  const { pipelineConfig, llms } = deps

  // Apply output language setting
  setOutputLanguage(pipelineConfig.outputLanguage)

  const tradePlanner = new TradePlanner({
    llm: llms.tradePlanner,
  })

  // Build research team based on enabled analysts
  const researcherTeam: IAgent[] = pipelineConfig.enabledAnalysts.map(
    (type) => ANALYST_BUILDERS[type](deps),
  )

  // Debate components (optional)
  let debateEngine: DebateEngine | undefined
  let researchManager: ResearchManager | undefined = new ResearchManager({
    llm: llms.researchManager ?? llms.manager,
  })
  let bullResearcher: IAgent | undefined
  let bearResearcher: IAgent | undefined

  if (pipelineConfig.debateEnabled) {
    bullResearcher = researcherTeam.find((a) => a.name === 'bullResearcher')
    bearResearcher = researcherTeam.find((a) => a.name === 'bearResearcher')

    if (bullResearcher && bearResearcher) {
      debateEngine = new DebateEngine({
        bullLlm: llms.bull,
        bearLlm: llms.bear,
        maxRounds: pipelineConfig.maxDebateRounds,
      })
    }
  }

  // Build risk team
  let riskTeam: IAgent[]

  if (pipelineConfig.riskDebateEnabled) {
    const riskAnalysts: IAgent[] = [
      new AggressiveRiskAnalyst({ llm: llms.riskAnalyst }),
      new ConservativeRiskAnalyst({ llm: llms.riskAnalyst }),
      new NeutralRiskAnalyst({ llm: llms.riskAnalyst }),
    ]
    const portfolioManager = new PortfolioManager({
      llm: llms.portfolioManager ?? llms.riskManager,
      riskAnalysts,
    })
    riskTeam = [portfolioManager]
  } else {
    riskTeam = [
      new RiskAnalyst({ llm: llms.riskAnalyst }),
      new RiskManager({ llm: llms.riskManager }),
    ]
  }

  // Data & analysis stages
  const dataFetcher = deps.dataSource
    ? new DataFetcher({
        dataSources: [deps.dataSource],
        vectorStore: deps.vectorStore,
        embedder: deps.embedder,
      })
    : undefined

  const technicalAnalyzer = deps.dataSource
    ? new TechnicalAnalyzer({ dataSource: deps.spyDataSource ?? deps.dataSource })
    : undefined

  // Indicator formatter for debate context
  const indicatorFormatter = (report: TradingReport): string => {
    if (!report.computedIndicators) return ''
    const ci = report.computedIndicators
    const fmt = (v: number | null, d = 2) => (v == null || isNaN(v) ? 'N/A' : v.toFixed(d))
    return [
      `SMA50=$${fmt(ci.trend.sma50)} SMA200=$${fmt(ci.trend.sma200)} MACD=${fmt(ci.trend.macd.line)}`,
      `RSI=${fmt(ci.momentum.rsi, 1)} Stoch %K=${fmt(ci.momentum.stochastic.k, 1)}`,
      `Bollinger [$${fmt(ci.volatility.bollingerLower)} / $${fmt(ci.volatility.bollingerMiddle)} / $${fmt(ci.volatility.bollingerUpper)}]`,
      `Beta=${fmt(ci.risk.beta)} VaR95=${fmt(ci.risk.var95 * 100, 2)}%`,
    ].join('\n')
  }

  return new Orchestrator({
    dataFetcher,
    technicalAnalyzer,
    researcherTeam,
    tradePlanner,
    riskTeam,
    manager: new Manager({
      llm: llms.manager,
      vectorStore: deps.vectorStore,
      embedder: deps.embedder,
    }),
    bullResearcher,
    bearResearcher,
    debateEngine,
    researchManager,
    indicatorFormatter,
  })
}
