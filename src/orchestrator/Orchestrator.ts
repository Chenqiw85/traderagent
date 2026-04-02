import type { IAgent } from '../agents/base/IAgent.js'
import type { Market, TradingReport } from '../agents/base/types.js'

type OrchestratorConfig = {
  dataFetcher?: IAgent
  technicalAnalyzer?: IAgent
  researcherTeam: IAgent[]
  riskTeam: IAgent[]
  manager: IAgent
}

type RunContext = {
  timestamp?: Date
}

export class Orchestrator {
  private dataFetcher?: IAgent
  private technicalAnalyzer?: IAgent
  private researcherTeam: IAgent[]
  private riskTeam: IAgent[]
  private manager: IAgent

  constructor(config: OrchestratorConfig) {
    this.dataFetcher = config.dataFetcher
    this.technicalAnalyzer = config.technicalAnalyzer
    this.researcherTeam = config.researcherTeam
    this.riskTeam = config.riskTeam
    this.manager = config.manager
  }

  async run(ticker: string, market: Market, context: RunContext = {}): Promise<TradingReport> {
    let report: TradingReport = {
      ticker,
      market,
      timestamp: context.timestamp ?? new Date(),
      rawData: [],
      researchFindings: [],
    }

    // Stage 1: Fetch data
    if (this.dataFetcher) {
      report = await this.dataFetcher.run(report)
    }

    // Stage 2: Compute technical indicators
    if (this.technicalAnalyzer) {
      report = await this.technicalAnalyzer.run(report)
    }

    // Debug: log rawData entry sizes before researchers consume them
    console.log(`\n${'═'.repeat(60)}`)
    console.log('RAW DATA INVENTORY (before researchers)')
    console.log(`${'═'.repeat(60)}`)
    for (const entry of report.rawData) {
      const json = JSON.stringify(entry.data)
      const chars = json.length
      const tokens = Math.ceil(chars / 4)
      const keys = entry.data && typeof entry.data === 'object' ? Object.keys(entry.data as object).join(', ') : '(primitive)'
      console.log(`  [${entry.type.padEnd(12)}] ${chars.toLocaleString().padStart(10)} chars  ≈ ${tokens.toLocaleString().padStart(8)} tokens  keys: ${keys}`)
    }
    const totalRawChars = report.rawData.reduce((s, e) => s + JSON.stringify(e.data).length, 0)
    console.log(`  ${'─'.repeat(56)}`)
    console.log(`  TOTAL RAW DATA: ${totalRawChars.toLocaleString()} chars  ≈ ${Math.ceil(totalRawChars / 4).toLocaleString()} tokens`)
    console.log(`${'═'.repeat(60)}\n`)

    // Stage 3: Researcher team — parallel
    // Each agent gets a copy of the current report so they don't conflict.
    // Findings from all researchers are merged back into the main report.
    if (this.researcherTeam.length > 0) {
      const researcherResults = await Promise.all(
        this.researcherTeam.map((agent) => agent.run({ ...report }))
      )
      report = {
        ...report,
        researchFindings: [
          ...report.researchFindings,
          ...researcherResults.flatMap((r) => r.researchFindings),
        ],
      }
    }

    // Stage 4: Risk team — sequential
    // RiskManager depends on riskAssessment set by RiskAnalyst, so they must run in order.
    for (const agent of this.riskTeam) {
      report = await agent.run(report)
    }

    // Stage 5: Manager — reads full report, outputs final decision
    report = await this.manager.run(report)

    return report
  }
}
