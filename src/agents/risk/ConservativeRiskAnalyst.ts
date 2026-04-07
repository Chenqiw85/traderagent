// src/agents/risk/ConservativeRiskAnalyst.ts

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

export class ConservativeRiskAnalyst implements IAgent {
  readonly name = 'conservativeRiskAnalyst'
  readonly role: AgentRole = 'risk'

  private readonly llm: ILLMProvider

  constructor(config: RiskAnalystConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const ci = report.computedIndicators
    if (!ci) {
      throw new Error('ConservativeRiskAnalyst: missing computedIndicators')
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

You are a CONSERVATIVE risk analyst who prioritizes capital preservation above all else. You believe in small positions, tight stop-losses, and that protecting against downside is more important than capturing upside.

${metricsContext}
${debateContext}
Given these metrics, provide your risk assessment. As a conservative analyst, you tend to classify risk as higher and recommend smaller positions.${debateContext ? ' Directly address and counter the other analysts\' arguments.' : ''}

Respond with ONLY a JSON object:
{
  "riskLevel": "low" | "medium" | "high",
  "maxPositionSize": <number, fraction of portfolio, e.g. 0.02 for 2%>,
  "reasoning": "<brief explanation>"
}`),
      },
      { role: 'user', content: `Assess risk for ${report.ticker} with a conservative stance. JSON only.` },
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
