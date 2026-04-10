import type { IAgent } from '../agents/base/IAgent.js'
import type { Finding, LessonRetrievalEvent, Market, TradingReport } from '../agents/base/types.js'
import type { DebateEngine } from '../agents/researcher/DebateEngine.js'
import type { ResearchManager } from '../agents/researcher/ResearchManager.js'
import { DataQualityAssessor } from '../agents/data/DataQualityAssessor.js'
import { FundamentalsScorer } from '../agents/researcher/FundamentalsScorer.js'
import { EvidenceValidator } from '../agents/researcher/EvidenceValidator.js'
import { ConflictDetector } from '../agents/researcher/ConflictDetector.js'
import { ConflictResolver } from '../agents/researcher/ConflictResolver.js'
import { ProposalValidator } from '../agents/trader/ProposalValidator.js'
import type { EvidenceResult } from '../types/quality.js'

type OrchestratorConfig = {
  dataFetcher?: IAgent
  realtimeQuoteFetcher?: IAgent
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
  /** Optional: Data quality assessor — runs after technical indicator computation */
  dataQualityAssessor?: DataQualityAssessor
  /** Optional: Fundamentals scorer — runs after technical analysis */
  fundamentalsScorer?: FundamentalsScorer
  /** Optional: Evidence validator — validates research findings before trade planning */
  evidenceValidator?: EvidenceValidator
  /** Optional: Conflict detector — detects metric contradictions between bull/bear */
  conflictDetector?: ConflictDetector
  /** Optional: Conflict resolver — resolves detected contradictions */
  conflictResolver?: ConflictResolver
  /** Optional: Proposal validator — validates trade proposal against research thesis */
  proposalValidator?: ProposalValidator
}

type RunContext = {
  timestamp?: Date
  onReportUpdate?: (report: TradingReport) => void | Promise<void>
}

export class Orchestrator {
  private dataFetcher?: IAgent
  private realtimeQuoteFetcher?: IAgent
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
  private dataQualityAssessor?: DataQualityAssessor
  private fundamentalsScorer?: FundamentalsScorer
  private evidenceValidator?: EvidenceValidator
  private conflictDetector?: ConflictDetector
  private conflictResolver?: ConflictResolver
  private proposalValidator?: ProposalValidator

  constructor(config: OrchestratorConfig) {
    this.dataFetcher = config.dataFetcher
    this.realtimeQuoteFetcher = config.realtimeQuoteFetcher
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
    this.dataQualityAssessor = config.dataQualityAssessor
    this.fundamentalsScorer = config.fundamentalsScorer
    this.evidenceValidator = config.evidenceValidator
    this.conflictDetector = config.conflictDetector
    this.conflictResolver = config.conflictResolver
    this.proposalValidator = config.proposalValidator
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

    // Stage 2: Overlay live market snapshot
    if (this.realtimeQuoteFetcher) {
      report = await this.realtimeQuoteFetcher.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 3: Compute technical indicators
    if (this.technicalAnalyzer) {
      report = await this.technicalAnalyzer.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 3b: Data quality assessment (after indicators so technicals completeness is accurate)
    if (this.dataQualityAssessor) {
      report = await this.dataQualityAssessor.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 3c: Fundamentals scoring
    if (this.fundamentalsScorer) {
      report = { ...report, fundamentalScores: this.fundamentalsScorer.score(report) }
      await this.publishReportUpdate(context, report)
    }

    // Stage 4: Research — parallel or debate mode
    if (this.debateEngine && this.bullResearcher && this.bearResearcher) {
      report = await this.runDebateMode(report)
    } else if (this.researcherTeam.length > 0) {
      report = await this.runParallelResearch(report)
    }
    await this.publishReportUpdate(context, report)

    // Stage 4b: Evidence validation — filters ungrounded research findings
    if (this.evidenceValidator) {
      const validations: EvidenceResult[] = []
      const validFindings: Finding[] = []

      for (const finding of report.researchFindings) {
        const result = await this.evidenceValidator.validate(finding, report)
        validations.push(result)
        if (result.valid) {
          validFindings.push(finding)
        }
      }

      // Fallback: keep all findings only if validation rejects everything.
      if (validFindings.length === 0) {
        report = { ...report, evidenceValidations: validations }
      } else {
        report = { ...report, researchFindings: validFindings, evidenceValidations: validations }
      }
      await this.publishReportUpdate(context, report)
    }

    // Stage 4c: Conflict detection + resolution
    if (this.conflictDetector && this.conflictResolver) {
      const bullFindings = report.researchFindings.filter((f) => f.stance === 'bull')
      const bearFindings = report.researchFindings.filter((f) => f.stance === 'bear')

      const overlaps = this.conflictDetector.findMetricOverlaps(bullFindings, bearFindings)
      const conflicts = await this.conflictDetector.checkContradictions(overlaps)

      if (report.computedIndicators) {
        const resolutions = await this.conflictResolver.resolveAll(
          conflicts,
          report.computedIndicators,
        )
        report = { ...report, conflicts, conflictResolutions: resolutions }
      } else {
        report = { ...report, conflicts }
      }
      await this.publishReportUpdate(context, report)
    }

    // Stage 4d: Research manager — synthesize the thesis after validation/resolution stages.
    if (this.researchManager) {
      report = await this.researchManager.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 5: Trade planner — converts thesis into an executable proposal
    if (this.tradePlanner) {
      report = await this.tradePlanner.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 5b: Proposal validation — checks alignment between proposal and research thesis
    if (this.proposalValidator && report.traderProposal && report.researchThesis) {
      const proposalValidation = this.proposalValidator.validate(
        report.traderProposal,
        report.researchThesis,
      )
      report = { ...report, proposalValidation }
      await this.publishReportUpdate(context, report)
    }

    // Stage 6: Risk team — sequential (or debate if configured via riskTeam)
    for (const agent of this.riskTeam) {
      report = await agent.run(report)
      await this.publishReportUpdate(context, report)
    }

    // Stage 7: Manager — reads full report, outputs final decision
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
      lessonRetrievals: this.mergeLessonRetrievals(report, researcherResults),
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
        lessonRetrievals: this.mergeLessonRetrievals(report, researcherResults),
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
      lessonRetrievals: this.mergeLessonRetrievals(report, researcherResults),
    }

    return updatedReport
  }

  private mergeLessonRetrievals(
    report: TradingReport,
    researcherResults: TradingReport[],
  ): LessonRetrievalEvent[] {
    const existing = report.lessonRetrievals ?? []
    const merged: LessonRetrievalEvent[] = [...existing]
    const seen = new Set(
      existing.map((event) => JSON.stringify(event)),
    )

    for (const result of researcherResults) {
      for (const event of result.lessonRetrievals ?? []) {
        const key = JSON.stringify(event)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(event)
      }
    }

    return merged
  }
}
