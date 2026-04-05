// src/agents/risk/PortfolioManager.ts

import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, RiskAssessment, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('portfolio-manager')

type PortfolioManagerConfig = {
  llm: ILLMProvider
  /** The three risk analyst agents whose assessments to synthesize */
  riskAnalysts: IAgent[]
}

type SynthesizedRisk = {
  riskLevel: 'low' | 'medium' | 'high'
  maxPositionSize: number
  stopLoss?: number
  takeProfit?: number
  reasoning: string
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

  constructor(config: PortfolioManagerConfig) {
    this.llm = config.llm
    this.riskAnalysts = config.riskAnalysts
  }

  async run(report: TradingReport): Promise<TradingReport> {
    // Run all risk analysts in parallel
    const results = await Promise.all(
      this.riskAnalysts.map((analyst) => analyst.run({ ...report }))
    )

    const assessments = results
      .map((r) => ({
        name: r.riskAssessment ? 'analyst' : 'unknown',
        assessment: r.riskAssessment,
      }))
      .filter((a) => a.assessment != null)

    if (assessments.length === 0) {
      log.warn('No risk assessments produced, skipping synthesis')
      return report
    }

    // Use the first assessment's metrics as the canonical risk metrics
    const canonicalMetrics = assessments[0]!.assessment!.metrics

    // Synthesize via LLM
    const synthesized = await this.synthesize(report, results)

    return {
      ...report,
      riskAssessment: {
        riskLevel: synthesized.riskLevel,
        metrics: canonicalMetrics,
        maxPositionSize: synthesized.maxPositionSize,
        stopLoss: synthesized.stopLoss,
        takeProfit: synthesized.takeProfit,
      },
    }
  }

  private async synthesize(
    report: TradingReport,
    analystResults: TradingReport[],
  ): Promise<SynthesizedRisk> {
    const assessmentBlock = analystResults
      .map((r) => {
        const ra = r.riskAssessment
        if (!ra) return null
        return `Risk Level: ${ra.riskLevel}, Position Size: ${ra.maxPositionSize ?? 'N/A'}`
      })
      .filter(Boolean)
      .map((desc, i) => {
        const labels = ['Aggressive', 'Conservative', 'Neutral']
        return `${labels[i] ?? `Analyst ${i + 1}`}: ${desc}`
      })
      .join('\n')

    const response = await this.llm.chat([
      {
        role: 'system',
        content: withLanguage(`You are a Portfolio Manager synthesizing risk assessments from three analysts with different risk philosophies for ${report.ticker}.

RISK ASSESSMENTS:
${assessmentBlock}

INSTRUCTIONS:
- Weigh the conservative view more heavily for capital preservation
- But don't be so conservative that you miss clear opportunities
- The neutral analyst's view should be the baseline
- Set concrete position size, stop-loss, and take-profit levels

Respond with ONLY a JSON object:
{
  "riskLevel": "low" | "medium" | "high",
  "maxPositionSize": <number, fraction of portfolio>,
  "stopLoss": <number, price level or null>,
  "takeProfit": <number, price level or null>,
  "reasoning": "<brief explanation of synthesis>"
}`),
      },
      { role: 'user', content: `Synthesize the risk debate for ${report.ticker}. JSON only.` },
    ])

    try {
      const parsed = parseJson<Partial<SynthesizedRisk>>(response)
      return {
        riskLevel: (['low', 'medium', 'high'].includes(parsed.riskLevel ?? '') ? parsed.riskLevel : 'medium') as SynthesizedRisk['riskLevel'],
        maxPositionSize: parsed.maxPositionSize ?? 0.05,
        stopLoss: parsed.stopLoss ?? undefined,
        takeProfit: parsed.takeProfit ?? undefined,
        reasoning: parsed.reasoning ?? '',
      }
    } catch {
      log.error('Failed to parse synthesis response')
      return {
        riskLevel: 'medium',
        maxPositionSize: 0.05,
        reasoning: 'Defaulted due to synthesis failure',
      }
    }
  }
}
