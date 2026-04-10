import type { ComputedIndicators } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { Conflict, Resolution } from '../../types/quality.js'

type ConflictResolverConfig = { readonly llm: ILLMProvider }

export class ConflictResolver {
  private readonly llm: ILLMProvider
  constructor(config: ConflictResolverConfig) { this.llm = config.llm }

  filterForResolution(conflicts: Conflict[]): Conflict[] {
    return conflicts.filter((c) => c.isContradiction && (c.severity === 'high' || c.severity === 'medium'))
  }

  async resolve(conflict: Conflict, indicators: ComputedIndicators): Promise<Resolution> {
    const prompt = `You are resolving a contradiction between bull and bear stock analysts. Use the ground-truth computed indicators to determine which side's interpretation is better supported.

CONFLICT METRIC: ${conflict.metric}
BULL CLAIM: ${conflict.bullClaim}
BEAR CLAIM: ${conflict.bearClaim}
SEVERITY: ${conflict.severity}

GROUND-TRUTH COMPUTED INDICATORS:
${JSON.stringify(indicators, null, 2)}

Determine:
1. Which side's claim is better supported by the actual data? (bull, bear, or both_valid)
2. Why?
3. How should confidence be adjusted for each side? (0-1 scale)

Respond with ONLY valid JSON (no markdown fencing):
{ "winner": "bull" | "bear" | "both_valid", "reasoning": "explanation", "adjustedConfidence": { "bull": number, "bear": number } }`

    try {
      const response = await this.llm.chat([{ role: 'user', content: prompt }])
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const parsed = JSON.parse(cleaned) as { winner: 'bull' | 'bear' | 'both_valid'; reasoning: string; adjustedConfidence: { bull: number; bear: number } }
      return { conflict, ...parsed }
    } catch {
      return { conflict, winner: 'both_valid', reasoning: 'Failed to parse conflict resolution — treating as both_valid', adjustedConfidence: { bull: 0.5, bear: 0.5 } }
    }
  }

  async resolveAll(conflicts: Conflict[], indicators: ComputedIndicators): Promise<Resolution[]> {
    const toResolve = this.filterForResolution(conflicts)
    const resolutions: Resolution[] = []
    for (const conflict of toResolve) {
      resolutions.push(await this.resolve(conflict, indicators))
    }
    return resolutions
  }
}
