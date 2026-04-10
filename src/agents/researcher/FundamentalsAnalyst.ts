import { BaseResearcher } from './BaseResearcher.js'
import type { DataType, TradingReport } from '../base/types.js'
import type { FundamentalScores } from '../../types/quality.js'

export class FundamentalsAnalyst extends BaseResearcher {
  readonly name = 'fundamentalsAnalyst'
  readonly requiredData: DataType[] = ['fundamentals']

  protected buildQuery(report: TradingReport): string {
    return `financial fundamentals earnings revenue PE ratio for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string, rawDataContext: string, indicators: string): string {
    const scoresSection = report.fundamentalScores
      ? `
## PRE-COMPUTED FUNDAMENTAL SCORES (from deterministic analysis)

The following scores have been computed from the actual data. Your job is to INTERPRET these scores in context — do NOT re-score. Explain why the scores are what they are and what they mean for the investment case.

- Valuation: ${report.fundamentalScores.valuation}/25
- Profitability: ${report.fundamentalScores.profitability}/25
- Financial Health: ${report.fundamentalScores.financialHealth}/25
- Growth: ${report.fundamentalScores.growth}/25
- TOTAL: ${report.fundamentalScores.total}/100

Available metrics: ${report.fundamentalScores.availableMetrics.join(', ')}
Missing metrics: ${report.fundamentalScores.missingMetrics.join(', ')}

Your fundamentalScore in the response JSON MUST equal ${report.fundamentalScores.total}. Do NOT invent a different score.
Your job: interpret WHY these scores are what they are, providing sector context and nuance.
`
      : ''

    const stanceInstruction = report.fundamentalScores
      ? `Stance derivation (MANDATORY):
- total >= 65 → "bull"
- 35 <= total < 65 → "neutral"
- total < 35 → "bear"
Based on computed total of ${report.fundamentalScores.total}, your stance MUST be "${report.fundamentalScores.total >= 65 ? 'bull' : report.fundamentalScores.total >= 35 ? 'neutral' : 'bear'}".`
      : `Stance determination: score >= 65 = bull, 35-65 = neutral, < 35 = bear`

    return `You are a fundamental equity analyst performing a structured valuation assessment of ${report.ticker}.

${indicators}

${context ? `=== RAG CONTEXT (historical patterns) ===\n${context}\n` : ''}
${rawDataContext ? `=== RAW DATA (for reference) ===\n${rawDataContext}\n` : ''}
${scoresSection}

VALUATION FRAMEWORK — score each dimension and cite specific numbers:

1. EARNINGS QUALITY (0-25 points):
   - Is EPS positive and growing? Negative or declining EPS = 0-5 points
   - Is P/E reasonable? P/E < 15 = value (20-25pts), 15-25 = fair (12-20pts), 25-50 = growth premium (8-12pts), 50-100 = speculative (3-8pts), >100 = extreme (0-3pts)
   - If P/E is N/A, score based on other available earnings data

2. BALANCE SHEET STRENGTH (0-25 points):
   - P/B ratio: < 1 = deep value (20-25pts), 1-3 = fair (12-20pts), 3-10 = premium (5-12pts), >10 = speculative (0-5pts)
   - Dividend yield present suggests cash flow health (bonus 0-5pts)

3. GROWTH PROFILE (0-25 points):
   - Revenue growth: >20% = high growth (20-25pts), 10-20% = moderate (12-20pts), 0-10% = slow (5-12pts), negative = contracting (0-5pts)
   - Compare growth rate to valuation: high P/E with low growth = RED FLAG

4. RISK-ADJUSTED VALUE (0-25 points):
   - PEG concept: P/E divided by growth rate. PEG < 1 = undervalued (20-25pts), 1-2 = fair (10-20pts), >2 = overvalued (0-10pts)
   - If growth is negative with high P/E, this score should be near 0

RULES:
- Extract ALL metrics from the computed indicators above — do NOT estimate missing values
- If a metric shows "N/A", report it as null and reduce confidence proportionally
- fundamentalScore = sum of the 4 dimension scores (0-100)
- ${stanceInstruction}
- Flag internal contradictions (e.g., high P/E + negative growth = bear regardless of other signals)

Respond with ONLY a JSON object:
{
  "stance": "bull" | "bear" | "neutral",
  "fundamentalScore": <number 0-100>,
  "keyMetrics": { "PE": <number or null>, "revenueGrowth": <number or null>, "profitMargin": <number or null> },
  "evidence": ["<point citing actual figures and dimension scores>", "..."],
  "confidence": <number 0-1>
}`
  }
}
