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
    const context = this.buildContext(report)
    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are a quantitative risk analyst. Calculate risk metrics for ${report.ticker}.
${context}
Respond with ONLY a JSON object matching this schema:
{
  "riskLevel": "low" | "medium" | "high",
  "metrics": {
    "VaR": <number, 1-day Value at Risk as decimal e.g. 0.03>,
    "volatility": <number, annualized volatility as decimal e.g. 0.22>,
    "beta": <number, beta vs market e.g. 1.1>,
    "maxDrawdown": <number, max drawdown as decimal e.g. 0.15>
  }
}`,
      },
      { role: 'user', content: `Calculate risk metrics for ${report.ticker}. Respond with JSON only.` },
    ])

    const partial = this.parseAssessment(response)
    return {
      ...report,
      riskAssessment: {
        riskLevel: partial.riskLevel ?? 'medium',
        metrics: partial.metrics ?? { VaR: 0, volatility: 0, beta: 1, maxDrawdown: 0 },
      },
    }
  }

  private buildContext(report: TradingReport): string {
    const lines: string[] = []
    const priceData = report.rawData.filter((d) => d.type === 'ohlcv')
    if (priceData.length > 0) {
      lines.push(`Price data: ${JSON.stringify(priceData[0].data).slice(0, 500)}`)
    }
    if (report.researchFindings.length > 0) {
      const summary = report.researchFindings
        .map((f) => `${f.agentName}: ${f.stance} (confidence: ${f.confidence})`)
        .join(', ')
      lines.push(`Research findings: ${summary}`)
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
