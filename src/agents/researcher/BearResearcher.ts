import { BaseResearcher } from './BaseResearcher.js'
import type { TradingReport } from '../base/types.js'

export class BearResearcher extends BaseResearcher {
  readonly name = 'bearResearcher'

  protected buildQuery(report: TradingReport): string {
    return `bearish investment signals and sell evidence for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string): string {
    return `You are a bearish equity analyst. Find evidence that supports selling or avoiding ${report.ticker}.
${context ? `\nRelevant market data:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bear",
  "evidence": ["<evidence point 1>", "<evidence point 2>"],
  "confidence": <number 0-1>
}`
  }
}
