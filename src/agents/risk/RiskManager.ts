// src/agents/risk/RiskManager.ts
import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'

type RiskManagerConfig = {
  llm: ILLMProvider
}

type PositionLimits = {
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
    if (!report.riskAssessment) return report

    const context = this.buildContext(report)
    const response = await this.llm.chat([
      {
        role: 'system',
        content: withLanguage(`You are a risk manager. Set position sizing and risk limits for ${report.ticker}.
${context}
Respond with ONLY a JSON object matching this schema:
{
  "maxPositionSize": <number, fraction of portfolio e.g. 0.05>,
  "stopLoss": <number, price level>,
  "takeProfit": <number, price level>
}`),
      },
      { role: 'user', content: `Set position limits for ${report.ticker}. Respond with JSON only.` },
    ])

    const limits = this.parseLimits(response)
    return {
      ...report,
      riskAssessment: {
        ...report.riskAssessment,
        maxPositionSize: limits.maxPositionSize,
        stopLoss: limits.stopLoss,
        takeProfit: limits.takeProfit,
      },
    }
  }

  private buildContext(report: TradingReport): string {
    const ra = report.riskAssessment!
    const stances = report.researchFindings.map((f) => `${f.agentName}: ${f.stance}`).join(', ')
    return [
      `Risk level: ${ra.riskLevel}`,
      `VaR: ${ra.metrics.VaR}, Volatility: ${ra.metrics.volatility}, Beta: ${ra.metrics.beta}, Max Drawdown: ${ra.metrics.maxDrawdown}`,
      stances ? `Research stances: ${stances}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  private parseLimits(response: string): PositionLimits {
    try {
      return parseJson<PositionLimits>(response)
    } catch {
      return {}
    }
  }
}
