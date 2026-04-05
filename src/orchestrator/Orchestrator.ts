import type { IAgent } from '../agents/base/IAgent.js'
import type { Finding, Market, TradingReport } from '../agents/base/types.js'
import type { DebateEngine } from '../agents/researcher/DebateEngine.js'
import type { ResearchManager } from '../agents/researcher/ResearchManager.js'

type OrchestratorConfig = {
  dataFetcher?: IAgent
  technicalAnalyzer?: IAgent
  researcherTeam: IAgent[]
  tradePlanner?: IAgent
  riskTeam: IAgent[]
  manager: IAgent
  /** Optional: Bull researcher for debate mode (must be in researcherTeam too) */
  bullResearcher?: IAgent
  /** Optional: Bear researcher for debate mode */
  bearResearcher?: IAgent
  /** Optional: Debate engine for bull-bear adversarial rounds */
  debateEngine?: DebateEngine
  /** Optional: Research manager to synthesize debate results */
  researchManager?: ResearchManager
  /** Optional: Indicator formatter for debate context */
  indicatorFormatter?: (report: TradingReport) => string
}

type RunContext = {
  timestamp?: Date
  onReportUpdate?: (report: TradingReport) => void | Promise<void>
}

export class Orchestrator {
  private dataFetcher?: IAgent
  private technicalAnalyzer?: IAgent
  private researcherTeam: IAgent[]
  private tradePlanner?: IAgent
  private riskTeam: IAgent[]
  private manager: IAgent
  private bullResearcher?: IAgent
  private bearResearcher?: IAgent
  private debateEngine?: DebateEngine
  private researchManager?: ResearchManager
  private indicatorFormatter?: (report: TradingReport) => string

  constructor(config: OrchestratorConfig) {
    this.dataFetcher = config.dataFetcher
    this.technicalAnalyzer = config.technicalAnalyzer
    this.researcherTeam = config.researcherTeam
    this.tradePlanner = config.tradePlanner
    this.riskTeam = config.riskTeam
    this.manager = config.manager
    this.bullResearcher = config.bullResearcher
    this.bearResearcher = config.bearResearcher
    this.debateEngine = config.debateEngine
    this.researchManager = config.researchManager
    this.indicatorFormatter = config.indicatorFormatter
  }

  async run(ticker: string, market: Market, context: RunContext = {}): Promise<TradingReport> {
    let report: TradingReport = {
      ticker,
      market,
      timestamp: context.timestamp ?? new Date(),
      rawData: [],
      researchFindings: [],
      analysisArtifacts: [],
    }

    // Stage 1: Fetch data
    if (this.dataFetcher) {
      report = await this.dataFetcher.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 2: Compute technical indicators
    if (this.technicalAnalyzer) {
      report = await this.technicalAnalyzer.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 3: Research — parallel or debate mode
    if (this.debateEngine && this.bullResearcher && this.bearResearcher) {
      report = await this.runDebateMode(report)
    } else if (this.researcherTeam.length > 0) {
      report = await this.runParallelResearch(report)
    }
    await this.publishReportUpdate(context, report)

    // Stage 3b: Research manager — synthesizes a thesis when available
    if (this.researchManager && !(this.debateEngine && this.bullResearcher && this.bearResearcher)) {
      report = await this.researchManager.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 4: Trade planner — converts thesis into an executable proposal
    if (this.tradePlanner) {
      report = await this.tradePlanner.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 5: Risk team — sequential (or debate if configured via riskTeam)
    for (const agent of this.riskTeam) {
      report = await agent.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 6: Manager — reads full report, outputs final decision
    report = await this.manager.run(report)
    await this.publishReportUpdate(context, report)

    return report
  }

  private async publishReportUpdate(context: RunContext, report: TradingReport): Promise<void> {
    if (context.onReportUpdate) {
      await context.onReportUpdate(report)
    }
  }

  private async runParallelResearch(report: TradingReport): Promise<TradingReport> {
    const researcherResults = await Promise.all(
      this.researcherTeam.map((agent) => agent.run({ ...report }))
    )
    return {
      ...report,
      researchFindings: [
        ...report.researchFindings,
        ...researcherResults.flatMap((r) => r.researchFindings),
      ],
    }
  }

  private async runDebateMode(report: TradingReport): Promise<TradingReport> {
    // Step 1: Run all researchers in parallel to get initial findings
    const researcherResults = await Promise.all(
      this.researcherTeam.map((agent) => agent.run({ ...report }))
    )
    const allFindings: Finding[] = researcherResults.flatMap((r) => r.researchFindings)

    // Step 2: Extract initial bull and bear findings for debate
    const initialBull = allFindings.find((f) => f.stance === 'bull')
    const initialBear = allFindings.find((f) => f.stance === 'bear')

    if (!initialBull || !initialBear || !this.debateEngine) {
      // Fallback to parallel if we don't have both sides
      return {
        ...report,
        researchFindings: [...report.researchFindings, ...allFindings],
      }
    }

    // Step 3: Run debate rounds
    const indicators = this.indicatorFormatter ? this.indicatorFormatter(report) : ''
    const debateResult = await this.debateEngine.debate(
      report,
      initialBull,
      initialBear,
      indicators,
    )

    // Step 4: Collect all findings — initial non-debate + debate finals
    const nonDebateFindings = allFindings.filter((f) => f.stance === 'neutral')
    let updatedReport: TradingReport = {
      ...report,
      researchFindings: [
        ...report.researchFindings,
        ...nonDebateFindings,
        debateResult.bullFinal,
        debateResult.bearFinal,
      ],
    }

    // Step 5: Research Manager synthesis
    if (this.researchManager) {
      updatedReport = await this.researchManager.run(updatedReport)
    }

    return updatedReport
  }
}
