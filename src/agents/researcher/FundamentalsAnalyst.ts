import { BaseResearcher } from './BaseResearcher.js'
import type { DataType, TradingReport } from '../base/types.js'

export class FundamentalsAnalyst extends BaseResearcher {
  readonly name = 'fundamentalsAnalyst'
  readonly requiredData: DataType[] = ['fundamentals']

  protected buildQuery(report: TradingReport): string {
    return `financial fundamentals earnings revenue PE ratio for ${report.ticker}`
  }

  protected buildSystemPrompt(_report: TradingReport, context: string, rawDataContext: string, indicators: string): string {
    return `You are a fundamental equity analyst. Assess the financial health of ${_report.ticker}.

${indicators}

${context ? `=== RAG CONTEXT (historical patterns) ===\n${context}\n` : ''}
${rawDataContext ? `=== RAW DATA (for reference) ===\n${rawDataContext}\n` : ''}
RULES:
- Extract ALL metrics (PE, EPS, P/B, etc.) from the computed indicators above
- If a metric shows "N/A" above, report it as null — do NOT estimate
- Confidence must reflect data quality

Respond with ONLY a JSON object:
{
  "stance": "bull" | "bear" | "neutral",
  "fundamentalScore": <number 0-100>,
  "keyMetrics": { "PE": <number or null>, "revenueGrowth": <number or null>, "profitMargin": <number or null> },
  "evidence": ["<point citing actual figures>", "..."],
  "confidence": <number 0-1>
}`
  }
}
