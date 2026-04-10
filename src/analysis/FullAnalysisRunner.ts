import type { Market, TradingReport } from '../agents/base/types.js'
import type { Orchestrator } from '../orchestrator/Orchestrator.js'
import { getErrorMessage } from '../utils/errors.js'
import { createLogger } from '../utils/logger.js'
import type { AnalysisRunRepository } from './AnalysisRunRepository.js'

const log = createLogger('analysis:full-runner')

type RunTickerInput = {
  ticker: string
  market: Market
  asOf: Date
  ragMode?: string
}

type FullAnalysisRunnerConfig = {
  orchestrator: Orchestrator
  analysisRunRepository?: AnalysisRunRepository
}

export class FullAnalysisRunner {
  constructor(private readonly config: FullAnalysisRunnerConfig) {}

  async runTicker({ ticker, market, asOf, ragMode }: RunTickerInput): Promise<TradingReport> {
    const runId = this.config.analysisRunRepository
      ? await this.config.analysisRunRepository.startRun({ ticker, market, asOf, ragMode })
      : undefined

    let latestReport: TradingReport | undefined = {
      ticker,
      market,
      timestamp: asOf,
      rawData: [],
      researchFindings: [],
      analysisArtifacts: [],
    }

    const report = await this.runAnalysis(ticker, market, asOf, latestReport, runId)

    if (runId && this.config.analysisRunRepository) {
      try {
        await this.config.analysisRunRepository.completeRun(runId, {
          finalAction: report.finalDecision?.action,
          finalConfidence: report.finalDecision?.confidence,
          artifacts: report.analysisArtifacts ?? [],
          snapshot: report,
        })
      } catch (error) {
        log.warn({ runId, error: getErrorMessage(error) }, 'Failed to persist completed analysis run')
      }
    }

    return report
  }

  private async runAnalysis(
    ticker: string,
    market: Market,
    asOf: Date,
    latestReport: TradingReport | undefined,
    runId: string | undefined,
  ): Promise<TradingReport> {
    try {
      return await this.config.orchestrator.run(ticker, market, {
        timestamp: asOf,
        onReportUpdate: (partialReport) => {
          latestReport = partialReport
        },
      })
    } catch (error) {
      if (this.config.analysisRunRepository) {
        try {
          if (runId) {
            await this.config.analysisRunRepository.failRun(runId, {
              artifacts: latestReport?.analysisArtifacts ?? [],
              snapshot: latestReport,
            })
          }
        } catch {
          // Preserve the original analysis error even if persistence fails.
        }
      }

      throw error
    }
  }
}
