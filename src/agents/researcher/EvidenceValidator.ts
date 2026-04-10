// src/agents/researcher/EvidenceValidator.ts

import type { Finding, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { EvidenceResult } from '../../types/quality.js'

type EvidenceValidatorConfig = { readonly llm: ILLMProvider }

const VALID_STANCES = ['bull', 'bear', 'neutral'] as const

type SchemaResult = { readonly valid: boolean; readonly violations: readonly string[] }

export class EvidenceValidator {
  private readonly llm: ILLMProvider

  constructor(config: EvidenceValidatorConfig) {
    this.llm = config.llm
  }

  validateSchema(finding: Finding): SchemaResult {
    const violations: string[] = []

    if (finding.confidence == null) {
      violations.push('missing required field: confidence')
    } else if (finding.confidence < 0 || finding.confidence > 1) {
      violations.push(`confidence must be 0-1, got ${finding.confidence}`)
    }

    if (!finding.stance || !VALID_STANCES.includes(finding.stance as typeof VALID_STANCES[number])) {
      violations.push(`invalid stance: ${finding.stance}`)
    }

    if (!finding.agentName) {
      violations.push('missing required field: agentName')
    }

    if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
      violations.push('evidence must be a non-empty array of strings')
    }

    return { valid: violations.length === 0, violations }
  }

  async validate(finding: Finding, report: TradingReport): Promise<EvidenceResult> {
    const schema = this.validateSchema(finding)
    if (!schema.valid) {
      return {
        agentName: finding.agentName ?? 'unknown',
        valid: false,
        violations: schema.violations,
        groundedEvidence: [],
        ungroundedClaims: [],
      }
    }

    const indicatorsJson = JSON.stringify(report.computedIndicators ?? {}, null, 2)
    const rawFundamentals = report.rawData.find((d) => d.type === 'fundamentals')
    const rawNews = report.rawData.find((d) => d.type === 'news')

    const prompt = `You are an evidence grounding checker for stock analysis. Verify whether the claimed evidence is grounded in the actual data.

AGENT: ${finding.agentName}
STANCE: ${finding.stance}
CONFIDENCE: ${finding.confidence}
EVIDENCE CLAIMS:
${finding.evidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}

ACTUAL COMPUTED INDICATORS:
${indicatorsJson}

ACTUAL RAW FUNDAMENTALS:
${JSON.stringify(rawFundamentals?.data ?? {}, null, 2)}

ACTUAL RAW NEWS:
${JSON.stringify(rawNews?.data ?? '[]', null, 2)}

For each evidence claim, check:
1. Does the claimed number actually appear in or can be derived from the source data?
2. Is the claim fabricated or significantly misquoted?
3. Does the stated stance logically follow from the cited evidence?

Respond with ONLY valid JSON (no markdown fencing):
{
  "valid": boolean,
  "groundedEvidence": ["claims that match source data"],
  "ungroundedClaims": ["claims that don't match source data, with explanation"],
  "violations": ["specific mismatches between claimed and actual data"]
}`

    try {
      const response = await this.llm.chat([{ role: 'user', content: prompt }])
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const parsed = JSON.parse(cleaned) as {
        valid: boolean
        groundedEvidence: string[]
        ungroundedClaims: string[]
        violations: string[]
      }
      return {
        agentName: finding.agentName,
        valid: parsed.valid,
        violations: parsed.violations,
        groundedEvidence: parsed.groundedEvidence,
        ungroundedClaims: parsed.ungroundedClaims,
      }
    } catch {
      return {
        agentName: finding.agentName,
        valid: false,
        violations: ['Failed to parse LLM grounding check response'],
        groundedEvidence: [],
        ungroundedClaims: [],
      }
    }
  }
}
