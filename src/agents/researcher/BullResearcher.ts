import { BaseResearcher } from './BaseResearcher.js'
import type { TradingReport } from '../base/types.js'

export class BullResearcher extends BaseResearcher {
  readonly name = 'bullResearcher'

  protected buildQuery(report: TradingReport): string {
    return `bullish investment signals and buy evidence for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string): string {
    return `You are a bullish equity analyst. Find evidence that supports buying ${report.ticker}.
${context ? `\nRelevant market data:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bull",
  "evidence": ["<evidence point 1>", "<evidence point 2>"],
  "confidence": <number 0-1>
}`
  }
}
