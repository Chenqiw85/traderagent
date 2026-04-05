// src/agents/risk/RiskManager.ts
import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, RiskVerdict, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'

type RiskManagerConfig = {
  llm: ILLMProvider
}

type RiskReview = RiskVerdict & {
  maxPositionSize?: number
  stopLoss?: number
  takeProfit?: number
}

export class RiskManager implements IAgent {
  readonly name = 'riskManager'
  readonly role: AgentRole = 'risk'

  private llm: ILLMProvider

  constructor(config: RiskManagerConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    if (!report.riskAssessment || !report.traderProposal) return report

    const context = this.buildContext(report)
    const response = await this.llm.chat([
      {
        role: 'system',
        content: withLanguage(`You are a risk manager reviewing whether a concrete trader proposal should be approved for ${report.ticker}.
${context}
Review the proposal against the current risk profile. Use blockers for hard rejection reasons and requiredAdjustments for conditions that would make the setup acceptable.
Respond with ONLY a JSON object matching this schema:
{
  "approved": <boolean>,
  "summary": "<concise risk verdict>",
  "blockers": ["<blocker 1>", "<blocker 2>"],
  "requiredAdjustments": ["<adjustment 1>", "<adjustment 2>"],
  "maxPositionSize": <number, fraction of portfolio e.g. 0.05>,
  "stopLoss": <number, price level or null>,
  "takeProfit": <number, price level or null>
}`),
      },
      { role: 'user', content: `Review the trader proposal for ${report.ticker}. Respond with JSON only.` },
    ])

    const review = this.parseReview(response)
    const nextRiskAssessment = {
      ...report.riskAssessment,
      maxPositionSize: review.maxPositionSize,
      stopLoss: review.stopLoss,
      takeProfit: review.takeProfit,
    }

    return {
      ...report,
      riskAssessment: nextRiskAssessment,
      riskVerdict: {
        approved: review.approved,
        summary: review.summary,
        blockers: review.blockers,
        requiredAdjustments: review.requiredAdjustments,
      },
      analysisArtifacts: [
        ...(report.analysisArtifacts ?? []),
        {
          stage: 'risk',
          agent: this.name,
          summary: review.summary,
          payload: {
            approved: review.approved,
            summary: review.summary,
            blockers: review.blockers,
            requiredAdjustments: review.requiredAdjustments,
          },
        },
      ],
    }
  }

  private buildContext(report: TradingReport): string {
    const ra = report.riskAssessment!
    const proposal = report.traderProposal!
    const stances = report.researchFindings.map((f) => `${f.agentName}: ${f.stance}`).join(', ')
    return [
      '=== TRADER PROPOSAL ===',
      `Action: ${proposal.action} (confidence: ${proposal.confidence})`,
      `Summary: ${proposal.summary}`,
      `Entry logic: ${proposal.entryLogic}`,
      `Why now: ${proposal.whyNow}`,
      `Time horizon: ${proposal.timeHorizon}`,
      proposal.positionSizeFraction !== undefined ? `Requested position size: ${proposal.positionSizeFraction}` : '',
      proposal.stopLoss !== undefined ? `Proposed stop loss: ${proposal.stopLoss}` : '',
      proposal.takeProfit !== undefined ? `Proposed take profit: ${proposal.takeProfit}` : '',
      proposal.invalidationConditions.length > 0
        ? `Invalidation conditions: ${proposal.invalidationConditions.join('; ')}`
        : '',
      '',
      '=== RISK PROFILE ===',
      `Risk level: ${ra.riskLevel}`,
      `VaR: ${ra.metrics.VaR}, Volatility: ${ra.metrics.volatility}, Beta: ${ra.metrics.beta}, Max Drawdown: ${ra.metrics.maxDrawdown}`,
      report.researchThesis ? `Research thesis: ${report.researchThesis.summary}` : '',
      stances ? `Research stances: ${stances}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  private parseReview(response: string): RiskReview {
    try {
      const parsed = parseJson<Partial<RiskReview>>(response)
      return {
        approved: typeof parsed.approved === 'boolean' ? parsed.approved : false,
        summary: typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : 'Risk review completed without a clear verdict',
        blockers: this.normalizeStringArray(parsed.blockers),
        requiredAdjustments: this.normalizeStringArray(parsed.requiredAdjustments),
        maxPositionSize: this.normalizeFraction(parsed.maxPositionSize),
        stopLoss: this.normalizePositiveNumber(parsed.stopLoss),
        takeProfit: this.normalizePositiveNumber(parsed.takeProfit),
      }
    } catch {
      return {
        approved: false,
        summary: 'Unable to parse risk review response',
        blockers: ['Risk review response was invalid'],
        requiredAdjustments: [],
      }
    }
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  }

  private normalizeFraction(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : undefined
  }

  private normalizePositiveNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
  }
}
