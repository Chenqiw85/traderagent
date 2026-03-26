// src/evaluation/ReasoningEvaluator.ts
import type { IEvaluator, EvaluationResult } from './IEvaluator.js'
import type { TradingReport } from '../agents/base/types.js'
import type { ILLMProvider } from '../llm/ILLMProvider.js'
import { parseJson } from '../utils/parseJson.js'

type ReasoningEvaluatorConfig = {
  llm: ILLMProvider
}

type JudgmentResult = {
  logicalConsistency: number
  evidenceQuality: number
  confidenceCalibration: number
  notes: string
}

export class ReasoningEvaluator implements IEvaluator {
  private llm: ILLMProvider

  constructor(config: ReasoningEvaluatorConfig) {
    this.llm = config.llm
  }

  async evaluate(report: TradingReport): Promise<EvaluationResult> {
    const context = this.buildContext(report)
    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are an expert evaluator of trading research quality. Score the following analysis for ${report.ticker}.
${context}
Respond with ONLY a JSON object:
{
  "logicalConsistency": <number 0-1>,
  "evidenceQuality": <number 0-1>,
  "confidenceCalibration": <number 0-1>,
  "notes": "<brief explanation>"
}`,
      },
      { role: 'user', content: 'Evaluate the quality of this trading analysis. Respond with JSON only.' },
    ])

    const judgment = this.parseJudgment(response)
    const score =
      (judgment.logicalConsistency + judgment.evidenceQuality + judgment.confidenceCalibration) / 3

    return {
      score,
      breakdown: {
        logicalConsistency: judgment.logicalConsistency,
        evidenceQuality: judgment.evidenceQuality,
        confidenceCalibration: judgment.confidenceCalibration,
      },
      notes: judgment.notes,
    }
  }

  private buildContext(report: TradingReport): string {
    const lines: string[] = [`Ticker: ${report.ticker}`, `Market: ${report.market}`]
    for (const f of report.researchFindings) {
      lines.push(`${f.agentName}: ${f.stance} (confidence: ${f.confidence})`)
      if (f.evidence.length > 0) lines.push(`  Evidence: ${f.evidence.join('; ')}`)
    }
    if (report.finalDecision) {
      const d = report.finalDecision
      lines.push(`Final decision: ${d.action} (confidence: ${d.confidence})`)
      lines.push(`Reasoning: ${d.reasoning}`)
    }
    return lines.join('\n')
  }

  private parseJudgment(response: string): JudgmentResult {
    try {
      return parseJson<JudgmentResult>(response)
    } catch {
      return {
        logicalConsistency: 0.5,
        evidenceQuality: 0.5,
        confidenceCalibration: 0.5,
        notes: 'Unable to parse evaluator response',
      }
    }
  }
}
