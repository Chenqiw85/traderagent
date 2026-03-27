import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, RiskAssessment, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'

type RiskAnalystConfig = {
  llm: ILLMProvider
}

export class RiskAnalyst implements IAgent {
  readonly name = 'riskAnalyst'
  readonly role: AgentRole = 'risk'

  private llm: ILLMProvider

  constructor(config: RiskAnalystConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const ci = report.computedIndicators
    if (!ci) {
      throw new Error('RiskAnalyst: missing computedIndicators — TechnicalAnalyzer must run first')
    }

    // Use pre-computed risk metrics directly
    const riskMetrics = {
      VaR: ci.risk.var95,
      volatility: ci.volatility.historicalVolatility,
      beta: ci.risk.beta,
      maxDrawdown: ci.risk.maxDrawdown,
    }

    // Determine risk level from computed metrics
    const context = this.buildContext(report, riskMetrics)
    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are a quantitative risk analyst. The risk metrics below were computed from actual market data — do NOT recalculate them. Your job is to interpret these metrics and determine the overall risk level.
${context}
Respond with ONLY a JSON object:
{
  "riskLevel": "low" | "medium" | "high"
}`,
      },
      { role: 'user', content: `Classify the risk level for ${report.ticker} based on the pre-computed metrics. Respond with JSON only.` },
    ])

    const parsed = this.parseAssessment(response)

    return {
      ...report,
      riskAssessment: {
        riskLevel: parsed.riskLevel ?? 'medium',
        metrics: riskMetrics,
      },
    }
  }

  private buildContext(report: TradingReport, metrics: RiskAssessment['metrics']): string {
    const lines: string[] = [
      `Pre-computed risk metrics for ${report.ticker}:`,
      `  VaR (95%, 1-day): ${(metrics.VaR * 100).toFixed(2)}%`,
      `  Annualized volatility: ${(metrics.volatility * 100).toFixed(1)}%`,
      `  Beta vs market: ${metrics.beta.toFixed(2)}`,
      `  Max drawdown: ${(metrics.maxDrawdown * 100).toFixed(1)}%`,
    ]
    if (report.researchFindings.length > 0) {
      const summary = report.researchFindings
        .map((f) => `${f.agentName}: ${f.stance} (confidence: ${f.confidence.toFixed(2)})`)
        .join(', ')
      lines.push(`Research stances: ${summary}`)
    }
    return lines.join('\n')
  }

  private parseAssessment(response: string): Partial<RiskAssessment> {
    try {
      return parseJson<Partial<RiskAssessment>>(response)
    } catch {
      return {}
    }
  }
}
