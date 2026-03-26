import { BaseResearcher } from './BaseResearcher.js'
import type { TradingReport } from '../base/types.js'

export class FundamentalsAnalyst extends BaseResearcher {
  readonly name = 'fundamentalsAnalyst'

  protected buildQuery(report: TradingReport): string {
    return `financial fundamentals earnings revenue PE ratio for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string): string {
    return `You are a fundamental equity analyst. Assess the financial health of ${report.ticker}.
${context ? `\nFundamentals data:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bull" | "bear" | "neutral",
  "fundamentalScore": <number 0-100>,
  "keyMetrics": { "PE": <number>, "revenueGrowth": <number>, "profitMargin": <number> },
  "evidence": ["<fundamental point 1>", "<fundamental point 2>"],
  "confidence": <number 0-1>
}`
  }
}
