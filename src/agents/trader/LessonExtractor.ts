import { randomUUID } from 'node:crypto'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { Market } from '../base/types.js'
import type { LessonEntry, ScoredDecision } from './types.js'
import { parseJson } from '../../utils/parseJson.js'

type LessonExtractorConfig = {
  llm: ILLMProvider
}

type ExtractionInput = {
  decisions: ScoredDecision[]
  ticker: string
  market: Market | string
  passNumber: number
}

type RawLesson = {
  condition: string
  lesson: string
  evidence: string
  confidence?: number
}

export class LessonExtractor {
  private readonly llm: ILLMProvider

  constructor(config: LessonExtractorConfig) {
    this.llm = config.llm
  }

  async extract(input: ExtractionInput): Promise<LessonEntry[]> {
    const summary = this.buildDecisionSummary(input.decisions)
    const systemPrompt = this.buildSystemPrompt(input.ticker, summary)

    let response: string
    try {
      response = await this.llm.chat([
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Analyze these ${input.decisions.length} trading decisions for ${input.ticker} and extract lessons. Respond with a JSON array only.`,
        },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[LessonExtractor] LLM call failed for ${input.ticker} pass ${input.passNumber}: ${message}`)
      return []
    }

    return this.parseLessons(response, input)
  }

  private buildDecisionSummary(decisions: ScoredDecision[]): string {
    if (decisions.length === 0) {
      return 'Summary: 0 decisions available.'
    }

    const wins = decisions.filter((decision) => decision.breakdown.directional === 1).length
    const losses = decisions.filter((decision) => decision.breakdown.directional === 0).length
    const holds = decisions.filter((decision) => decision.decision.action === 'HOLD').length
    const avgScore =
      decisions.reduce((sum, decision) => sum + decision.compositeScore, 0) / decisions.length

    const lines = [
      `Summary: ${decisions.length} decisions, ${wins} wins, ${losses} losses, ${holds} holds`,
      `Average composite score: ${avgScore.toFixed(3)}`,
      '',
      'Individual decisions:',
    ]

    for (const decision of decisions) {
      const dateStr = decision.date.toISOString().slice(0, 10)
      lines.push(
        `  ${dateStr}: ${decision.decision.action} (conf=${decision.decision.confidence.toFixed(2)}) -> return=${(decision.actualReturn * 100).toFixed(2)}% score=${decision.compositeScore.toFixed(3)} | ${decision.decision.reasoning}`,
      )
    }

    return lines.join('\n')
  }

  private buildSystemPrompt(ticker: string, summary: string): string {
    return `You are a trading strategy analyst reviewing backtested decisions for ${ticker}.

Below are the scored decisions from a backtest run. Each shows the date, action (BUY/SELL/HOLD), confidence, actual return over 5 trading days, composite score, and reasoning.

${summary}

Your task: identify patterns in what went right and wrong. Extract structured lessons.

For each lesson, provide:
- condition: the market condition or signal pattern
- lesson: the actionable takeaway
- evidence: statistical summary from the decisions above
- confidence: how confident you are in this lesson (0-1)

Respond with ONLY a JSON array of lesson objects.`
  }

  private parseLessons(response: string, input: ExtractionInput): LessonEntry[] {
    try {
      const parsed = parseJson<RawLesson[]>(response)
      if (!Array.isArray(parsed)) return []

      return parsed
        .filter(
          (lesson) =>
            typeof lesson.condition === 'string' &&
            typeof lesson.lesson === 'string' &&
            typeof lesson.evidence === 'string',
        )
        .map((lesson) => ({
          id: randomUUID(),
          condition: lesson.condition,
          lesson: lesson.lesson,
          evidence: lesson.evidence,
          confidence: Math.min(1, Math.max(0, lesson.confidence ?? 0.5)),
          passNumber: input.passNumber,
          ticker: input.ticker,
          market: input.market,
        }))
    } catch {
      return []
    }
  }
}
