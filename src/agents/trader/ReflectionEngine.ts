// src/agents/trader/ReflectionEngine.ts

import { randomUUID } from 'node:crypto'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { Market } from '../base/types.js'
import type { ScoredDecision } from './types.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('reflection-engine')

export type Reflection = {
  id: string
  ticker: string
  market: string
  date: string
  action: string
  actualReturn: number
  compositeScore: number
  whatWorked: string[]
  whatFailed: string[]
  adjustments: string[]
  passNumber: number
}

type ReflectionConfig = {
  llm: ILLMProvider
}

type ReflectionInput = {
  decisions: ScoredDecision[]
  ticker: string
  market: Market | string
  passNumber: number
  /** Only reflect on decisions below this score threshold */
  scoreThreshold?: number
}

type RawReflection = {
  whatWorked: string[]
  whatFailed: string[]
  adjustments: string[]
}

/**
 * Structured post-trade reflection engine.
 * Analyzes worst-performing decisions to extract what went wrong and how to adjust.
 */
export class ReflectionEngine {
  private readonly llm: ILLMProvider

  constructor(config: ReflectionConfig) {
    this.llm = config.llm
  }

  async reflect(input: ReflectionInput): Promise<Reflection[]> {
    const threshold = input.scoreThreshold ?? 0.4
    const worstDecisions = input.decisions
      .filter((d) => d.compositeScore < threshold)
      .sort((a, b) => a.compositeScore - b.compositeScore)
      .slice(0, 5) // Focus on 5 worst decisions

    if (worstDecisions.length === 0) {
      log.info({ ticker: input.ticker }, 'No decisions below threshold, skipping reflection')
      return []
    }

    log.info(
      { ticker: input.ticker, count: worstDecisions.length, threshold },
      'Reflecting on worst decisions',
    )

    const reflections: Reflection[] = []

    for (const decision of worstDecisions) {
      const reflection = await this.reflectOnDecision(decision, input)
      if (reflection) {
        reflections.push(reflection)
      }
    }

    return reflections
  }

  private async reflectOnDecision(
    decision: ScoredDecision,
    input: ReflectionInput,
  ): Promise<Reflection | null> {
    const dateStr = decision.date.toISOString().slice(0, 10)

    const prompt = withLanguage(`You are a trading strategy post-mortem analyst reviewing a specific decision that performed poorly.

DECISION DETAILS:
- Date: ${dateStr}
- Action: ${decision.decision.action}
- Confidence: ${decision.decision.confidence.toFixed(2)}
- Reasoning: ${decision.decision.reasoning}
- Actual Return: ${(decision.actualReturn * 100).toFixed(2)}%
- Composite Score: ${decision.compositeScore.toFixed(3)}
- Hit Take Profit: ${decision.hitTakeProfit}
- Hit Stop Loss: ${decision.hitStopLoss}

Score Breakdown:
- Directional: ${decision.breakdown.directional}
- Target Hit: ${decision.breakdown.targetHit}
- Calibration: ${decision.breakdown.calibration.toFixed(3)}
- Hold Penalty: ${decision.breakdown.holdPenalty}

Analyze what went right, what went wrong, and what should be adjusted.

Respond with ONLY a JSON object:
{
  "whatWorked": ["<aspect that was correct>", "..."],
  "whatFailed": ["<specific failure>", "..."],
  "adjustments": ["<actionable adjustment for future decisions>", "..."]
}`)

    try {
      const response = await this.llm.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: `Reflect on this ${decision.decision.action} decision for ${input.ticker} on ${dateStr}. JSON only.` },
      ])

      const parsed = parseJson<RawReflection>(response)

      return {
        id: randomUUID(),
        ticker: input.ticker,
        market: String(input.market),
        date: dateStr,
        action: decision.decision.action,
        actualReturn: decision.actualReturn,
        compositeScore: decision.compositeScore,
        whatWorked: parsed.whatWorked ?? [],
        whatFailed: parsed.whatFailed ?? [],
        adjustments: parsed.adjustments ?? [],
        passNumber: input.passNumber,
      }
    } catch (err) {
      log.warn(
        { ticker: input.ticker, date: dateStr, error: err instanceof Error ? err.message : String(err) },
        'Reflection failed for decision',
      )
      return null
    }
  }
}
