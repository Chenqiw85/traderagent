// src/agents/risk/AggressiveRiskAnalyst.ts

import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, RiskAssessment, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
import { tickerPreservationInstruction } from '../../prompts/tickerPreservation.js'
import { buildRiskMetricsContext, extractDebateContext, type RiskDebateAssessment } from './riskDebateUtils.js'

type RiskAnalystConfig = {
  llm: ILLMProvider
}

export class AggressiveRiskAnalyst implements IAgent {
  readonly name = 'aggressiveRiskAnalyst'
  readonly role: AgentRole = 'risk'

  private readonly llm: ILLMProvider

  constructor(config: RiskAnalystConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const ci = report.computedIndicators
    if (!ci) {
      throw new Error('AggressiveRiskAnalyst: missing computedIndicators')
    }

    const riskMetrics = {
      VaR: ci.risk.var95,
      volatility: ci.volatility.historicalVolatility,
      beta: ci.risk.beta,
      maxDrawdown: ci.risk.maxDrawdown,
    }

    const metricsContext = buildRiskMetricsContext(report.ticker, riskMetrics)
    const debateContext = extractDebateContext(report, this.name)

    const response = await this.llm.chat([
      {
        role: 'system',
        content: withLanguage(`${tickerPreservationInstruction(report.ticker)}

You are an AGGRESSIVE risk analyst who favors higher returns and is willing to accept more risk. You believe in taking larger positions when conviction is high, and that volatility represents opportunity, not just danger.

${metricsContext}
${debateContext}
Given these metrics, provide your risk assessment. As an aggressive analyst, you tend to classify risk as lower and recommend larger positions.${debateContext ? ' Directly address and counter the other analysts\' arguments.' : ''}

Respond with ONLY a JSON object:
{
  "riskLevel": "low" | "medium" | "high",
  "maxPositionSize": <number, fraction of portfolio, e.g. 0.10 for 10%>,
  "reasoning": "<brief explanation>"
}`),
      },
      { role: 'user', content: `Assess risk for ${report.ticker} with an aggressive stance. JSON only.` },
    ])

    const parsed = parseJson<RiskDebateAssessment>(response)

    return {
      ...report,
      riskAssessment: {
        riskLevel: (['low', 'medium', 'high'].includes(parsed.riskLevel ?? '') ? parsed.riskLevel : 'medium') as RiskAssessment['riskLevel'],
        metrics: riskMetrics,
        maxPositionSize: parsed.maxPositionSize,
      },
      analysisArtifacts: [
        ...(report.analysisArtifacts ?? []),
        {
          stage: 'risk',
          agent: this.name,
          summary: parsed.reasoning ?? '',
          payload: { riskLevel: parsed.riskLevel, maxPositionSize: parsed.maxPositionSize, reasoning: parsed.reasoning },
        },
      ],
    }
  }
}
