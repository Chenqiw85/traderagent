import { BaseResearcher } from './BaseResearcher.js'
import type { DataType, TradingReport } from '../base/types.js'

export class BearResearcher extends BaseResearcher {
  readonly name = 'bearResearcher'
  readonly requiredData: DataType[] = ['ohlcv', 'fundamentals']

  protected buildQuery(report: TradingReport): string {
    return `bearish investment signals and sell evidence for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string, rawDataContext: string): string {
    return `You are a bearish equity analyst. Find evidence that supports selling or avoiding ${report.ticker}.
IMPORTANT: Base ALL evidence points on the actual data provided below. Do not fabricate numbers or cite data not present.
${rawDataContext ? `\nMarket data fetched from Yahoo Finance:\n${rawDataContext}\n` : '\nWARNING: No market data available. State this clearly in your evidence and set confidence to 0.\n'}
${context ? `\nAdditional context:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bear",
  "evidence": ["<evidence point citing specific numbers from the data>", "..."],
  "confidence": <number 0-1, use 0 if no data was provided>
}`
  }
}
