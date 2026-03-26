import { BaseResearcher } from './BaseResearcher.js'
import type { TradingReport } from '../base/types.js'

export class NewsAnalyst extends BaseResearcher {
  readonly name = 'newsAnalyst'

  protected buildQuery(report: TradingReport): string {
    return `recent news articles and market sentiment for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string): string {
    return `You are a financial news analyst. Analyze recent news and market sentiment for ${report.ticker}.
${context ? `\nRecent news:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bull" | "bear" | "neutral",
  "sentiment": "<overall sentiment description>",
  "evidence": ["<news point 1>", "<news point 2>"],
  "confidence": <number 0-1>
}`
  }
}
