// src/agents/risk/NeutralRiskAnalyst.ts

import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, RiskAssessment, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'

type RiskAnalystConfig = {
  llm: ILLMProvider
}

export class NeutralRiskAnalyst implements IAgent {
  readonly name = 'neutralRiskAnalyst'
  readonly role: AgentRole = 'risk'

  private readonly llm: ILLMProvider

  constructor(config: RiskAnalystConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const ci = report.computedIndicators
    if (!ci) {
      throw new Error('NeutralRiskAnalyst: missing computedIndicators')
    }

    const riskMetrics = {
      VaR: ci.risk.var95,
      volatility: ci.volatility.historicalVolatility,
      beta: ci.risk.beta,
      maxDrawdown: ci.risk.maxDrawdown,
    }

    const context = [
      `Risk metrics for ${report.ticker}:`,
      `  VaR (95%): ${(riskMetrics.VaR * 100).toFixed(2)}%`,
      `  Volatility: ${(riskMetrics.volatility * 100).toFixed(1)}%`,
      `  Beta: ${riskMetrics.beta.toFixed(2)}`,
      `  Max Drawdown: ${(riskMetrics.maxDrawdown * 100).toFixed(1)}%`,
    ].join('\n')

    const response = await this.llm.chat([
      {
        role: 'system',
        content: withLanguage(`You are a NEUTRAL risk analyst who balances risk and reward objectively. You use standard risk management frameworks and academic principles to assess positions without bias toward either aggressive or conservative approaches.

${context}

Given these metrics, provide your balanced risk assessment.

Respond with ONLY a JSON object:
{
  "riskLevel": "low" | "medium" | "high",
  "maxPositionSize": <number, fraction of portfolio, e.g. 0.05 for 5%>,
  "reasoning": "<brief explanation>"
}`),
      },
      { role: 'user', content: `Assess risk for ${report.ticker} with a neutral stance. JSON only.` },
    ])

    const parsed = parseJson<{ riskLevel?: string; maxPositionSize?: number; reasoning?: string }>(response)

    return {
      ...report,
      riskAssessment: {
        riskLevel: (['low', 'medium', 'high'].includes(parsed.riskLevel ?? '') ? parsed.riskLevel : 'medium') as RiskAssessment['riskLevel'],
        metrics: riskMetrics,
        maxPositionSize: parsed.maxPositionSize,
      },
    }
  }
}
