import { BaseResearcher } from './BaseResearcher.js'
import type { DataType, TradingReport } from '../base/types.js'

export class BullResearcher extends BaseResearcher {
  readonly name = 'bullResearcher'
  readonly requiredData: DataType[] = ['ohlcv', 'fundamentals']

  protected buildQuery(report: TradingReport): string {
    return `bullish investment signals and buy evidence for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string, rawDataContext: string): string {
    return `You are a bullish equity analyst. Find evidence that supports buying ${report.ticker}.
IMPORTANT: Base ALL evidence points on the actual data provided below. Do not fabricate numbers or cite data not present.
${rawDataContext ? `\nMarket data fetched from Yahoo Finance:\n${rawDataContext}\n` : '\nWARNING: No market data available. State this clearly in your evidence and set confidence to 0.\n'}
${context ? `\nAdditional context:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bull",
  "evidence": ["<evidence point citing specific numbers from the data>", "..."],
  "confidence": <number 0-1, use 0 if no data was provided>
}`
  }
}
