import { BaseResearcher } from './BaseResearcher.js'
import type { DataType, TradingReport } from '../base/types.js'

export class BearResearcher extends BaseResearcher {
  readonly name = 'bearResearcher'
  readonly requiredData: DataType[] = ['ohlcv', 'fundamentals']

  protected buildQuery(report: TradingReport): string {
    return `bearish investment signals and sell evidence for ${report.ticker}`
  }

  protected buildSystemPrompt(_report: TradingReport, context: string, rawDataContext: string, indicators: string): string {
    return `You are a bearish equity analyst. Find evidence that supports selling or avoiding ${_report.ticker}.

${indicators}

${context ? `=== RAG CONTEXT (historical patterns) ===\n${context}\n` : ''}
${rawDataContext ? `=== RAW DATA (for reference) ===\n${rawDataContext}\n` : ''}
RULES:
- ALL evidence MUST cite specific numbers from the indicators or data above
- If a data point is not shown above, say "data not available" — do NOT estimate
- Confidence must reflect data quality: strong data = high confidence, gaps = lower

Respond with ONLY a JSON object:
{
  "stance": "bear",
  "evidence": ["<evidence citing specific numbers>", "..."],
  "confidence": <number 0-1>
}`
  }
}
