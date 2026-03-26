import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, Finding, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IVectorStore } from '../../rag/IVectorStore.js'
import type { Embedder } from '../../rag/embedder.js'
import { parseJson } from '../../utils/parseJson.js'

export type ResearcherConfig = {
  llm: ILLMProvider
  vectorStore?: IVectorStore
  embedder?: Embedder
  topK?: number
}

export abstract class BaseResearcher implements IAgent {
  abstract readonly name: string
  readonly role: AgentRole = 'researcher'

  protected llm: ILLMProvider
  protected vectorStore?: IVectorStore
  protected embedder?: Embedder
  protected topK: number

  constructor(config: ResearcherConfig) {
    this.llm = config.llm
    this.vectorStore = config.vectorStore
    this.embedder = config.embedder
    this.topK = config.topK ?? 5
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const context = await this.retrieveContext(report)
    const systemPrompt = this.buildSystemPrompt(report, context)
    const response = await this.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analyze ${report.ticker} on the ${report.market} market. Respond with JSON only.` },
    ])
    const finding = this.parseFinding(response)
    return {
      ...report,
      researchFindings: [...report.researchFindings, finding],
    }
  }

  protected async retrieveContext(report: TradingReport): Promise<string> {
    if (!this.vectorStore || !this.embedder) return ''
    const query = this.buildQuery(report)
    const embedding = await this.embedder.embed(query)
    const docs = await this.vectorStore.search(embedding, this.topK, {
      must: [{ ticker: report.ticker }],
    })
    return docs.map((d) => d.content).join('\n\n')
  }

  protected parseFinding(response: string): Finding {
    try {
      const parsed = parseJson<Partial<Finding>>(response)
      return {
        agentName: this.name,
        stance: parsed.stance ?? 'neutral',
        evidence: parsed.evidence ?? [],
        confidence: parsed.confidence ?? 0.5,
        sentiment: parsed.sentiment,
        fundamentalScore: parsed.fundamentalScore,
        keyMetrics: parsed.keyMetrics,
      }
    } catch {
      return {
        agentName: this.name,
        stance: 'neutral',
        evidence: [`${this.name} was unable to parse LLM response`],
        confidence: 0,
      }
    }
  }

  protected abstract buildQuery(report: TradingReport): string
  protected abstract buildSystemPrompt(report: TradingReport, context: string): string
}
