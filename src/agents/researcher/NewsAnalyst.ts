import { BaseResearcher } from './BaseResearcher.js'
import type { DataType, TradingReport } from '../base/types.js'

export class NewsAnalyst extends BaseResearcher {
  readonly name = 'newsAnalyst'
  readonly requiredData: DataType[] = []

  protected buildQuery(report: TradingReport): string {
    return `recent news articles and market sentiment for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string, rawDataContext: string): string {
    return `You are a financial news and sentiment analyst. Analyze market sentiment for ${report.ticker}.
IMPORTANT: Base ALL evidence on the actual data provided below (analyst ratings, target prices, sector/industry info). Do not fabricate news headlines or events.
${rawDataContext ? `\nData fetched from Yahoo Finance:\n${rawDataContext}\n` : '\nWARNING: No market data available. State this clearly in your evidence and set confidence to 0.\n'}
${context ? `\nAdditional context:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bull" | "bear" | "neutral",
  "sentiment": "<description of sentiment derived from analyst ratings and available data>",
  "evidence": ["<point citing specific data such as analyst rating or target price>", "..."],
  "confidence": <number 0-1, use 0 if no data was provided>
}`
  }
}
