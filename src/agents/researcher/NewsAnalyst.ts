import { BaseResearcher } from './BaseResearcher.js'
import type { DataType, TradingReport } from '../base/types.js'

export class NewsAnalyst extends BaseResearcher {
  readonly name = 'newsAnalyst'
  readonly requiredData: DataType[] = []

  protected buildQuery(report: TradingReport): string {
    return `recent news articles and market sentiment for ${report.ticker}`
  }

  protected buildSystemPrompt(_report: TradingReport, context: string, rawDataContext: string, indicators: string): string {
    return `You are a financial news and sentiment analyst for ${_report.ticker}.

${indicators}

${context ? `=== RAG CONTEXT (historical patterns) ===\n${context}\n` : ''}
${rawDataContext ? `=== RAW DATA (for reference) ===\n${rawDataContext}\n` : ''}
RULES:
- Base ALL evidence on the data provided (analyst ratings, target prices, sector info)
- Do not fabricate news headlines or events
- If no news data is available, clearly state that and lower confidence
- Confidence must reflect data quality

Respond with ONLY a JSON object:
{
  "stance": "bull" | "bear" | "neutral",
  "sentiment": "<description derived from available data>",
  "evidence": ["<point citing specific data>", "..."],
  "confidence": <number 0-1>
}`
  }
}
