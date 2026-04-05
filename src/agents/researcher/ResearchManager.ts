// src/agents/researcher/ResearchManager.ts

import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, Finding, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('research-manager')

type ResearchManagerConfig = {
  llm: ILLMProvider
}

type SynthesizedFinding = {
  stance: 'bull' | 'bear' | 'neutral'
  evidence: string[]
  confidence: number
  reasoning: string
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

    const synthesized = await this.synthesize(report)

    return {
      ...report,
      researchFindings: [
        ...report.researchFindings,
        synthesized,
      ],
    }
  }

  private async synthesize(report: TradingReport): Promise<Finding> {
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
- Determine the overall investment stance
- Your confidence should reflect how decisive the debate was

Respond with ONLY a JSON object:
{
  "stance": "bull" | "bear" | "neutral",
  "evidence": ["<key point 1 from synthesis>", "<key point 2>", "..."],
  "confidence": <number 0-1>,
  "reasoning": "<brief explanation of why this side won the debate>"
}`)

    try {
      const response = await this.llm.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: `Synthesize the debate for ${report.ticker}. JSON only.` },
      ])

      const parsed = parseJson<Partial<SynthesizedFinding>>(response)
      const validStances = ['bull', 'bear', 'neutral'] as const
      const stance: Finding['stance'] = validStances.includes(parsed.stance as Finding['stance'])
        ? (parsed.stance as Finding['stance'])
        : 'neutral'

      return {
        agentName: this.name,
        stance,
        evidence: parsed.evidence ?? [],
        confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
        sentiment: parsed.reasoning,
      }
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : String(err) }, 'Synthesis failed')
      return {
        agentName: this.name,
        stance: 'neutral',
        evidence: ['Research synthesis was unable to complete'],
        confidence: 0,
      }
    }
  }
}
