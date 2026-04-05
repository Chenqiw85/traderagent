// src/agents/researcher/ResearchManager.ts

import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, AnalysisArtifact, Finding, ResearchThesis, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
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

    const prompt = withLanguage(`You are a Research Manager synthesizing a structured bull-bear debate about ${report.ticker}.

BULL ARGUMENTS:
${formatFindings(bullFindings) || '(none)'}

BEAR ARGUMENTS:
${formatFindings(bearFindings) || '(none)'}

${otherFindings.length > 0 ? `OTHER ANALYSIS:\n${formatFindings(otherFindings)}` : ''}

INSTRUCTIONS:
- Weigh the strength of evidence from both sides
- Identify which arguments are supported by data vs speculation
- Determine the overall investment stance and write a concise thesis summary
- Identify the most important drivers, risks, and invalidation conditions
- Choose a realistic time horizon for the thesis

Respond with ONLY a JSON object:
{
  "stance": "bull" | "bear" | "neutral",
  "confidence": <number 0-1>,
  "summary": "<concise thesis paragraph>",
  "keyDrivers": ["<driver 1>", "<driver 2>", "..."],
  "keyRisks": ["<risk 1>", "<risk 2>", "..."],
  "invalidationConditions": ["<condition 1>", "<condition 2>", "..."],
  "timeHorizon": "short" | "swing" | "position"
}`)

    try {
      const response = await this.llm.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: `Synthesize the debate for ${report.ticker}. JSON only.` },
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
