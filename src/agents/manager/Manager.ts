// src/agents/manager/Manager.ts
import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, Decision, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IVectorStore } from '../../rag/IVectorStore.js'
import type { IEmbedder } from '../../rag/IEmbedder.js'
import { parseJson } from '../../utils/parseJson.js'

type ManagerConfig = {
  llm: ILLMProvider
  vectorStore?: IVectorStore
  embedder?: IEmbedder
}

export class Manager implements IAgent {
  readonly name = 'manager'
  readonly role: AgentRole = 'manager'

  private llm: ILLMProvider
  private vectorStore?: IVectorStore
  private embedder?: IEmbedder

  constructor(config: ManagerConfig) {
    this.llm = config.llm
    this.vectorStore = config.vectorStore
    this.embedder = config.embedder
  }

  async run(report: TradingReport): Promise<TradingReport> {
    if (report.researchFindings.length === 0) {
      throw new Error('Manager: cannot make a decision — no research findings available')
    }

    const context = this.buildContext(report)
    const lessonContext = await this.retrieveLessons(report)
    const fullContext = lessonContext
      ? `${context}\n\n=== LESSONS FROM PAST ANALYSIS ===\n${lessonContext}`
      : context
    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are a senior portfolio manager making a final trading decision for ${report.ticker}.
${fullContext}
Weigh the bull and bear evidence against the risk assessment. Make a final BUY, SELL, or HOLD recommendation.
Respond with ONLY a JSON object matching this schema:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": <number 0-1>,
  "reasoning": "<clear explanation of the decision>",
  "suggestedPositionSize": <number, fraction of portfolio>,
  "stopLoss": <number or null>,
  "takeProfit": <number or null>
}`,
      },
      { role: 'user', content: `Make a final decision for ${report.ticker}. Respond with JSON only.` },
    ])

    const decision = this.parseDecision(response)
    return { ...report, finalDecision: decision }
  }

  private async retrieveLessons(report: TradingReport): Promise<string> {
    if (!this.vectorStore || !this.embedder) return ''

    const query = `trading decision lessons for ${report.ticker}`
    const embedding = await this.embedder.embed(query)
    const docs = await this.vectorStore.search(embedding, 3, {
      must: [{ ticker: report.ticker }, { type: 'lesson' }],
    })

    return docs.map((doc) => doc.content).join('\n\n')
  }

  private buildContext(report: TradingReport): string {
    const lines: string[] = []
    for (const f of report.researchFindings) {
      lines.push(`${f.agentName}: ${f.stance} (confidence: ${f.confidence})`)
      if (f.evidence.length > 0) lines.push(`  Evidence: ${f.evidence.slice(0, 3).join('; ')}`)
      if (f.sentiment) lines.push(`  Sentiment: ${f.sentiment}`)
      if (f.fundamentalScore !== undefined) lines.push(`  Fundamental score: ${f.fundamentalScore}`)
    }
    if (report.riskAssessment) {
      const ra = report.riskAssessment
      lines.push(`Risk: ${ra.riskLevel} | VaR: ${ra.metrics.VaR} | Volatility: ${ra.metrics.volatility}`)
      if (ra.maxPositionSize !== undefined) lines.push(`Max position: ${ra.maxPositionSize}`)
      if (ra.stopLoss !== undefined) lines.push(`Stop loss: ${ra.stopLoss}`)
    }
    return lines.join('\n')
  }

  private parseDecision(response: string): Decision {
    try {
      const parsed = parseJson<Partial<Decision>>(response)
      return {
        action: parsed.action ?? 'HOLD',
        confidence: parsed.confidence ?? 0.5,
        reasoning: parsed.reasoning ?? 'Unable to parse manager response',
        suggestedPositionSize: parsed.suggestedPositionSize,
        stopLoss: parsed.stopLoss,
        takeProfit: parsed.takeProfit,
      }
    } catch {
      return {
        action: 'HOLD',
        confidence: 0,
        reasoning: 'Manager was unable to parse LLM response',
      }
    }
  }
}
