import { BaseResearcher } from './BaseResearcher.js'
import type { DataType, TradingReport } from '../base/types.js'

export class BullResearcher extends BaseResearcher {
  readonly name = 'bullResearcher'
  readonly requiredData: DataType[] = ['ohlcv', 'fundamentals']

  protected buildQuery(report: TradingReport): string {
    return `bullish investment signals and buy evidence for ${report.ticker}`
  }

  protected buildSystemPrompt(_report: TradingReport, context: string, rawDataContext: string, indicators: string): string {
    return `You are a bullish equity analyst building the investment case for buying ${_report.ticker}.

${indicators}

${context ? `=== RAG CONTEXT (historical patterns) ===\n${context}\n` : ''}
${rawDataContext ? `=== RAW DATA (for reference) ===\n${rawDataContext}\n` : ''}

ANALYTICAL FRAMEWORK — evaluate each category and cite specific numbers:

1. MOMENTUM & TREND: Is price above key moving averages (SMA50, SMA200)? Is MACD bullish? RSI in favorable zone (40-70)? Stochastic turning up?
2. VALUATION OPPORTUNITY: Is P/E reasonable relative to growth (PEG concept)? Is P/B in line with sector norms? If valuation is stretched, is there a growth catalyst that justifies it?
3. CATALYSTS: What upcoming events or current trends could drive the stock higher? (earnings momentum, revenue acceleration, sector tailwinds, product launches from news/data)
4. TECHNICAL SETUP: Is there a clear entry point? Support levels from Bollinger bands? Volume confirmation (OBV trend)?

RULES:
- ALL evidence MUST cite specific numbers from the indicators or data above
- If a data point is not shown above, say "data not available" — do NOT estimate
- You MUST acknowledge the strongest bear case in your evidence (e.g., "Despite elevated P/E of X, growth rate of Y% justifies..."). This shows intellectual honesty and strengthens your bull case
- Confidence scoring guide:
  * 0.8-1.0: Multiple strong signals aligned (trend + valuation + catalyst)
  * 0.6-0.8: Mostly bullish with minor concerns
  * 0.4-0.6: Mixed signals, bull case depends on assumptions
  * 0.2-0.4: Weak bull case, significant headwinds
  * 0.0-0.2: Almost no bullish evidence
- If valuation metrics (P/E, P/B) are extreme (P/E > 100 or negative, P/B > 10), confidence MUST be reduced by at least 0.15 unless you cite specific growth data justifying the premium

Respond with ONLY a JSON object:
{
  "stance": "bull",
  "evidence": ["<evidence citing specific numbers>", "..."],
  "confidence": <number 0-1>
}`
  }
}
