import { BaseResearcher } from './BaseResearcher.js'
import type { DataType, TradingReport } from '../base/types.js'

export class BearResearcher extends BaseResearcher {
  readonly name = 'bearResearcher'
  readonly requiredData: DataType[] = ['ohlcv', 'fundamentals']

  protected buildQuery(report: TradingReport): string {
    return `bearish investment signals and sell evidence for ${report.ticker}`
  }

  protected buildSystemPrompt(_report: TradingReport, context: string, rawDataContext: string, indicators: string): string {
    return `You are a bearish equity analyst identifying risks and reasons to sell or avoid ${_report.ticker}.

${indicators}

${context ? `=== RAG CONTEXT (historical patterns) ===\n${context}\n` : ''}
${rawDataContext ? `=== RAW DATA (for reference) ===\n${rawDataContext}\n` : ''}

ANALYTICAL FRAMEWORK — evaluate each risk category and cite specific numbers:

1. VALUATION RISK: Is P/E elevated vs historical norms or growth rate? Is P/B stretched? Are margins compressing (check EPS vs revenue)? Quantify the downside if valuation reverts to sector average
2. TECHNICAL DETERIORATION: Is price below key moving averages? Is MACD bearish (line below signal)? RSI oversold or trending down? Stochastic showing downward momentum? Recent bars showing lower highs/lower lows?
3. VOLATILITY & DRAWDOWN RISK: How severe is historical volatility? What does VaR95 imply for daily loss? How deep was max drawdown? Is beta amplifying market risk?
4. FUNDAMENTAL WEAKNESS: Is revenue growth negative or decelerating? Are profit margins shrinking? Is EPS declining? Any red flags in the data (negative earnings, high debt signals)?

RULES:
- ALL evidence MUST cite specific numbers from the indicators or data above
- If a data point is not shown above, say "data not available" — do NOT estimate
- You MUST acknowledge the strongest bull case and explain why the risk outweighs it (e.g., "While SMA50 > SMA200 suggests uptrend, the extreme P/E of X makes this rally vulnerable because...")
- For each risk, quantify the potential impact where possible (e.g., "VaR95 of X% means a $10,000 position could lose $Y in a single day")
- Confidence scoring guide:
  * 0.8-1.0: Multiple strong risk signals (overvaluation + technical breakdown + fundamental weakness)
  * 0.6-0.8: Clear risks with some offsetting positives
  * 0.4-0.6: Mixed signals, bear case depends on assumptions
  * 0.2-0.4: Minor risks, mostly healthy picture
  * 0.0-0.2: Almost no bearish evidence

Respond with ONLY a JSON object:
{
  "stance": "bear",
  "evidence": ["<evidence citing specific numbers>", "..."],
  "confidence": <number 0-1>
}`
  }
}
