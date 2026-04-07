// src/agents/risk/PortfolioManager.ts

import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
import { tickerPreservationInstruction } from '../../prompts/tickerPreservation.js'
import type { RiskDebateEngine } from './RiskDebateEngine.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('portfolio-manager')
const VALID_RISK_LEVELS = ['low', 'medium', 'high'] as const

type PortfolioManagerConfig = {
  llm: ILLMProvider
  /** The three risk analyst agents whose assessments to synthesize */
  riskAnalysts: IAgent[]
  /** Optional: debate engine for multi-round risk debate */
  debateEngine?: RiskDebateEngine
}

type SynthesizedRisk = {
  isValid: boolean
  approved: boolean
  riskLevel: 'low' | 'medium' | 'high'
  maxPositionSize: number
  stopLoss?: number
  takeProfit?: number
  summary: string
  blockers: string[]
  requiredAdjustments: string[]
}

/**
 * Runs multiple risk analysts (aggressive, conservative, neutral) in parallel,
 * then synthesizes their assessments into a final risk recommendation.
 */
export class PortfolioManager implements IAgent {
  readonly name = 'portfolioManager'
  readonly role: AgentRole = 'risk'

  private readonly llm: ILLMProvider
  private readonly riskAnalysts: IAgent[]
  private readonly debateEngine?: RiskDebateEngine

  constructor(config: PortfolioManagerConfig) {
    this.llm = config.llm
    this.riskAnalysts = config.riskAnalysts
    this.debateEngine = config.debateEngine
  }

  async run(report: TradingReport): Promise<TradingReport> {
    // When debate engine is available, run multi-round debate instead of parallel
    let debatedReport: TradingReport
    if (this.debateEngine) {
      debatedReport = await this.debateEngine.debate(report)
    } else {
      // Run all risk analysts in parallel (original behavior)
      const results = await Promise.all(
        this.riskAnalysts.map((analyst) => analyst.run({ ...report }))
      )
      // Merge all artifacts and pick the last assessment
      debatedReport = {
        ...report,
        riskAssessment: results.find((r) => r.riskAssessment)?.riskAssessment,
        analysisArtifacts: [
          ...(report.analysisArtifacts ?? []),
          ...results.flatMap((r) => r.analysisArtifacts ?? []).filter((a) => a.stage === 'risk'),
        ],
      }
    }

    // Collect all risk assessments from artifacts for synthesis prompt
    const riskArtifacts = (debatedReport.analysisArtifacts ?? []).filter(
      (a) => a.stage === 'risk' && a.agent !== this.name,
    )

    const assessments = riskArtifacts
      .map((a) => {
        const payload = a.payload as { riskLevel?: string; maxPositionSize?: number } | undefined
        return payload?.riskLevel ? { name: a.agent, payload } : null
      })
      .filter((a) => a != null)

    if (assessments.length === 0) {
      log.warn('No risk assessments produced, failing closed')
      const riskVerdict = {
        approved: false,
        summary: 'No risk assessments were produced by the analyst set.',
        blockers: ['Risk synthesis could not run because no analyst returned a risk assessment.'],
        requiredAdjustments: [],
      }
      return {
        ...debatedReport,
        riskVerdict,
        analysisArtifacts: [
          ...(debatedReport.analysisArtifacts ?? []),
          {
            stage: 'risk',
            agent: this.name,
            summary: riskVerdict.summary,
            payload: riskVerdict,
          },
        ],
      }
    }

    // Use the debated report's risk metrics (set by the last analyst to run)
    const canonicalMetrics = debatedReport.riskAssessment?.metrics ?? {
      VaR: 0, volatility: 0, beta: 1, maxDrawdown: 0,
    }

    // Synthesize via LLM
    const synthesized = await this.synthesize(debatedReport, assessments)
    const riskVerdict = {
      approved: synthesized.isValid ? synthesized.approved : false,
      summary: synthesized.summary,
      blockers: synthesized.blockers,
      requiredAdjustments: synthesized.requiredAdjustments,
    }

    return {
      ...debatedReport,
      riskAssessment: {
        riskLevel: synthesized.riskLevel,
        metrics: canonicalMetrics,
        maxPositionSize: synthesized.maxPositionSize,
        stopLoss: synthesized.stopLoss,
        takeProfit: synthesized.takeProfit,
      },
      riskVerdict,
      analysisArtifacts: [
        ...(debatedReport.analysisArtifacts ?? []),
        {
          stage: 'risk',
          agent: this.name,
          summary: riskVerdict.summary,
          payload: riskVerdict,
        },
      ],
    }
  }

  private async synthesize(
    report: TradingReport,
    assessments: Array<{ name: string; payload: { riskLevel?: string; maxPositionSize?: number; reasoning?: string } }>,
  ): Promise<SynthesizedRisk> {
    const assessmentBlock = assessments
      .map((a) => {
        const reasoning = a.payload.reasoning ? ` — ${a.payload.reasoning}` : ''
        return `${a.name}: Risk Level: ${a.payload.riskLevel}, Position Size: ${a.payload.maxPositionSize ?? 'N/A'}${reasoning}`
      })
      .join('\n')
    const proposalBlock = report.traderProposal
      ? [
          '=== TRADER PROPOSAL ===',
          `Action: ${report.traderProposal.action} (confidence: ${report.traderProposal.confidence})`,
          `Summary: ${report.traderProposal.summary}`,
          `Entry logic: ${report.traderProposal.entryLogic}`,
          `Why now: ${report.traderProposal.whyNow}`,
          `Time horizon: ${report.traderProposal.timeHorizon}`,
          report.traderProposal.positionSizeFraction !== undefined
            ? `Requested position size: ${report.traderProposal.positionSizeFraction}`
            : '',
          report.traderProposal.stopLoss !== undefined
            ? `Proposed stop loss: ${report.traderProposal.stopLoss}`
            : '',
          report.traderProposal.takeProfit !== undefined
            ? `Proposed take profit: ${report.traderProposal.takeProfit}`
            : '',
          report.traderProposal.invalidationConditions.length > 0
            ? `Invalidation conditions: ${report.traderProposal.invalidationConditions.join('; ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : ''
    const thesisLine = report.researchThesis
      ? `Research thesis: ${report.researchThesis.summary}`
      : ''

    const response = await this.llm.chat([
      {
        role: 'system',
        content: withLanguage(`${tickerPreservationInstruction(report.ticker)}

You are a Portfolio Manager synthesizing risk assessments from three analysts with different risk philosophies for ${report.ticker}.

RISK ASSESSMENTS:
${assessmentBlock}
${proposalBlock ? `\n\n${proposalBlock}` : ''}
${thesisLine ? `\n\n${thesisLine}` : ''}

INSTRUCTIONS:
- Weigh the conservative view more heavily for capital preservation
- But don't be so conservative that you miss clear opportunities
- The neutral analyst's view should be the baseline
- Evaluate the concrete trader proposal, not just the abstract analyst assessments
- Set concrete position size, stop-loss, and take-profit levels
- Use blockers for hard rejection reasons and requiredAdjustments for conditions that would make the proposal acceptable

Respond with ONLY a JSON object:
{
  "approved": <boolean>,
  "riskLevel": "low" | "medium" | "high",
  "maxPositionSize": <number, fraction of portfolio>,
  "stopLoss": <number, price level or null>,
  "takeProfit": <number, price level or null>,
  "summary": "<brief explanation of synthesis>",
  "blockers": ["<blocker 1>", "<blocker 2>"],
  "requiredAdjustments": ["<adjustment 1>", "<adjustment 2>"]
}`),
      },
      { role: 'user', content: `Synthesize the risk debate for ${report.ticker}. JSON only.` },
    ])

    try {
      const validated = this.validateSynthesis(parseJson<unknown>(response))
      return {
        isValid: true,
        approved: validated.approved,
        riskLevel: validated.riskLevel,
        maxPositionSize: validated.maxPositionSize,
        stopLoss: validated.stopLoss,
        takeProfit: validated.takeProfit,
        summary: validated.summary,
        blockers: validated.blockers,
        requiredAdjustments: validated.requiredAdjustments,
      }
    } catch {
      log.error('Failed to parse synthesis response')
      return {
        isValid: false,
        approved: false,
        riskLevel: 'high',
        maxPositionSize: 0.05,
        summary: 'Defaulted due to synthesis failure',
        blockers: ['Risk synthesis failed; rejecting until a valid portfolio verdict is available.'],
        requiredAdjustments: [],
      }
    }
  }

  private validateSynthesis(value: unknown): Omit<SynthesizedRisk, 'isValid'> {
    if (!this.isRecord(value)) {
      throw new Error('Synthesis response must be an object')
    }

    const riskLevel = value['riskLevel']
    if (typeof riskLevel !== 'string' || !VALID_RISK_LEVELS.includes(riskLevel as SynthesizedRisk['riskLevel'])) {
      throw new Error('Invalid riskLevel')
    }

    const maxPositionSize = value['maxPositionSize']
    if (typeof maxPositionSize !== 'number' || !Number.isFinite(maxPositionSize) || maxPositionSize < 0 || maxPositionSize > 1) {
      throw new Error('Invalid maxPositionSize')
    }

    const stopLoss = this.normalizePositiveNumber(value['stopLoss'])
    const takeProfit = this.normalizePositiveNumber(value['takeProfit'])

    if (value['stopLoss'] !== undefined && value['stopLoss'] !== null && stopLoss === undefined) {
      throw new Error('Invalid stopLoss')
    }
    if (value['takeProfit'] !== undefined && value['takeProfit'] !== null && takeProfit === undefined) {
      throw new Error('Invalid takeProfit')
    }

    const summarySource = typeof value['summary'] === 'string'
      ? value['summary']
      : typeof value['reasoning'] === 'string'
        ? value['reasoning']
        : ''
    const summary = summarySource.trim()
    if (summary.length === 0) {
      throw new Error('Invalid summary')
    }

    const approved = typeof value['approved'] === 'boolean'
      ? value['approved']
      : riskLevel !== 'high'

    const blockers = this.normalizeStringArray(value['blockers'])
    const requiredAdjustments = this.normalizeStringArray(value['requiredAdjustments'])

    return {
      approved,
      riskLevel: riskLevel as SynthesizedRisk['riskLevel'],
      maxPositionSize,
      stopLoss,
      takeProfit,
      summary,
      blockers,
      requiredAdjustments,
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private normalizePositiveNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }
}
