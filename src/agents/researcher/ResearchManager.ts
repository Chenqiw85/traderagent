// src/agents/researcher/ResearchManager.ts

import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, AnalysisArtifact, Finding, ResearchThesis, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { Conflict, Resolution } from '../../types/quality.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
import { tickerPreservationInstruction } from '../../prompts/tickerPreservation.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('research-manager')

type ResearchManagerConfig = {
  llm: ILLMProvider
}

type SynthesizedThesis = {
  stance: 'bull' | 'bear' | 'neutral'
  confidence: number
  summary: string
  keyDrivers: string[]
  keyRisks: string[]
  invalidationConditions: string[]
  timeHorizon: ResearchThesis['timeHorizon']
}

const VALID_STANCES = ['bull', 'bear', 'neutral'] as const
const VALID_TIME_HORIZONS = ['short', 'swing', 'position'] as const

function isValidStance(value: unknown): value is ResearchThesis['stance'] {
  return typeof value === 'string' && VALID_STANCES.includes(value as ResearchThesis['stance'])
}

function isValidTimeHorizon(value: unknown): value is ResearchThesis['timeHorizon'] {
  return typeof value === 'string' && VALID_TIME_HORIZONS.includes(value as ResearchThesis['timeHorizon'])
}

function normalizeConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return fallback
  return value
}

function normalizeSummary(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : ''
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function isThesisObject(value: unknown): value is Partial<SynthesizedThesis> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Synthesizes findings from a bull-bear debate into a single investment thesis.
 * Acts as the Research Manager who weighs both sides and produces a balanced view.
 */
export class ResearchManager implements IAgent {
  readonly name = 'researchManager'
  readonly role: AgentRole = 'researcher'

  private readonly llm: ILLMProvider

  constructor(config: ResearchManagerConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    if (report.researchFindings.length === 0) return report

    const thesis = await this.synthesize(report)
    const summary = thesis.summary.trim()
    const evidence = [summary, ...thesis.keyDrivers.slice(0, 2)]
      .filter((item) => item.length > 0)
    const compatibilityFinding: Finding = {
      agentName: this.name,
      stance: thesis.stance,
      evidence,
      confidence: thesis.confidence,
      sentiment: thesis.summary,
    }
    const analysisArtifact: AnalysisArtifact = {
      stage: 'research',
      agent: this.name,
      summary: thesis.summary,
      payload: thesis,
    }

    return {
      ...report,
      researchThesis: thesis,
      researchFindings: [...report.researchFindings, compatibilityFinding],
      analysisArtifacts: [...(report.analysisArtifacts ?? []), analysisArtifact],
    }
  }

  private async synthesize(report: TradingReport): Promise<ResearchThesis> {
    const bullFindings = report.researchFindings.filter((f) => f.stance === 'bull')
    const bearFindings = report.researchFindings.filter((f) => f.stance === 'bear')
    const otherFindings = report.researchFindings.filter((f) => f.stance === 'neutral')

    const formatFindings = (findings: Finding[]): string =>
      findings.map((f) =>
        `${f.agentName} (confidence: ${f.confidence.toFixed(2)}): ${f.evidence.join('; ')}`
      ).join('\n')

    const conflictsSection = (report.conflicts?.length ?? 0) > 0
      ? `
## DETECTED CONFLICTS

The following conflicts were detected between bull and bear researchers. Each has been resolved — use these resolutions to weight your synthesis.

${(report.conflicts ?? []).map((c: Conflict, i: number) => {
  const resolution = (report.conflictResolutions ?? []).find((r: Resolution) => r.conflict.metric === c.metric)
  return `### Conflict ${i + 1}: ${c.metric}
- Bull claim: ${c.bullClaim}
- Bear claim: ${c.bearClaim}
- Is contradiction: ${c.isContradiction}
- Severity: ${c.severity}
${resolution ? `- Resolution: winner=${resolution.winner}, reasoning: ${resolution.reasoning}
- Adjusted confidence: bull=${resolution.adjustedConfidence.bull}, bear=${resolution.adjustedConfidence.bear}` : '- Resolution: pending'}`
}).join('\n\n')}

When synthesizing, give more weight to the winning side of each resolved conflict. If winner is "both_valid", acknowledge both perspectives.
`
      : ''

    const prompt = withLanguage(`${tickerPreservationInstruction(report.ticker)}

You are a Research Manager synthesizing a structured bull-bear debate about ${report.ticker}. Your job is to be the impartial arbiter who determines which side has stronger evidence.

BULL ARGUMENTS:
${formatFindings(bullFindings) || '(none)'}

BEAR ARGUMENTS:
${formatFindings(bearFindings) || '(none)'}

${otherFindings.length > 0 ? `OTHER ANALYSIS:\n${formatFindings(otherFindings)}` : ''}${conflictsSection}

SYNTHESIS METHODOLOGY — follow these steps:

STEP 1: EVIDENCE QUALITY SCORING
For each argument from both sides, classify as:
- DATA-BACKED (cites specific numbers from indicators/fundamentals): weight 1.0
- DATA-INFERRED (reasonable conclusion from available data): weight 0.7
- SPECULATIVE (opinion without supporting data): weight 0.3
- CONTRADICTED (conflicts with actual data shown): weight 0.0

STEP 2: CONSISTENCY CHECK
- Do any bull arguments contradict bear arguments using the SAME data point? If so, determine which interpretation is more sound
- Does any analyst have high confidence (>0.7) despite citing weak or speculative evidence? Flag this as unreliable
- Example: A bull case citing "SMA50 > SMA200" is valid, but if price is BELOW both SMAs, the bullish signal is weakened

STEP 3: NET ASSESSMENT
- Sum weighted bull evidence strength vs weighted bear evidence strength
- The side with stronger DATA-BACKED arguments should generally prevail
- If both sides are roughly equal, stance should be neutral with moderate confidence
- A single DATA-BACKED critical risk (e.g., extreme P/E >100 with negative growth) can override multiple weaker bullish signals

STEP 4: CONFIDENCE CALIBRATION
- 0.8-1.0: One side overwhelmingly supported by data, other side mostly speculative
- 0.6-0.8: Clear lean with some valid counterpoints
- 0.4-0.6: Genuinely mixed evidence, could go either way
- 0.2-0.4: Slight lean but low conviction
- 0.0-0.2: Insufficient data to form a view

RULES:
- Your summary MUST explain WHY you chose the stance — which specific evidence was decisive
- keyDrivers should only include DATA-BACKED or DATA-INFERRED points
- keyRisks should include the strongest arguments from the opposing side
- invalidationConditions must be specific and measurable (price levels, indicator thresholds)

Respond with ONLY a JSON object:
{
  "stance": "bull" | "bear" | "neutral",
  "confidence": <number 0-1>,
  "summary": "<thesis paragraph explaining which evidence was decisive and why>",
  "keyDrivers": ["<driver 1>", "<driver 2>", "..."],
  "keyRisks": ["<risk 1>", "<risk 2>", "..."],
  "invalidationConditions": ["<measurable condition 1>", "<measurable condition 2>", "..."],
  "timeHorizon": "short" | "swing" | "position"
}`)

    try {
      const response = await this.llm.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: `Synthesize the debate for ${report.ticker}. JSON only.${conflictsSection}` },
      ])

      const parsed = parseJson<unknown>(response)
      if (!isThesisObject(parsed)) {
        throw new Error('LLM response must be a JSON object')
      }

      const stance: ResearchThesis['stance'] = isValidStance(parsed.stance) ? parsed.stance : 'neutral'
      const timeHorizon: ResearchThesis['timeHorizon'] = isValidTimeHorizon(parsed.timeHorizon) ? parsed.timeHorizon : 'short'

      return {
        stance,
        confidence: normalizeConfidence(parsed.confidence, 0.5),
        summary: normalizeSummary(parsed.summary),
        keyDrivers: normalizeStringArray(parsed.keyDrivers),
        keyRisks: normalizeStringArray(parsed.keyRisks),
        invalidationConditions: normalizeStringArray(parsed.invalidationConditions),
        timeHorizon,
      }
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : String(err) }, 'Synthesis failed')
      return {
        stance: 'neutral',
        confidence: 0,
        summary: '',
        keyDrivers: [],
        keyRisks: [],
        invalidationConditions: [],
        timeHorizon: 'short',
      }
    }
  }
}
