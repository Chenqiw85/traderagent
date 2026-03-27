import { BaseResearcher } from './BaseResearcher.js'
import type { DataType, TradingReport } from '../base/types.js'

export class FundamentalsAnalyst extends BaseResearcher {
  readonly name = 'fundamentalsAnalyst'
  readonly requiredData: DataType[] = ['fundamentals']

  protected buildQuery(report: TradingReport): string {
    return `financial fundamentals earnings revenue PE ratio for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string, rawDataContext: string): string {
    return `You are a fundamental equity analyst. Assess the financial health of ${report.ticker}.
IMPORTANT: Extract ALL metrics (PE, EPS, market cap, etc.) directly from the data below. Do not invent or estimate numbers.
${rawDataContext ? `\nFundamentals data fetched from Yahoo Finance:\n${rawDataContext}\n` : '\nWARNING: No fundamentals data available. Set fundamentalScore to 50 and confidence to 0, and state no data in evidence.\n'}
${context ? `\nAdditional context:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bull" | "bear" | "neutral",
  "fundamentalScore": <number 0-100>,
  "keyMetrics": { "PE": <number or null>, "revenueGrowth": <number or null>, "profitMargin": <number or null> },
  "evidence": ["<fundamental point citing actual figures from the data>", "..."],
  "confidence": <number 0-1, use 0 if no data was provided>
}`
  }
}
