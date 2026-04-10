// src/types/quality.ts

export type DimensionQuality = {
  readonly available: readonly string[]
  readonly missing: readonly string[]
  readonly completeness: number // 0-1
  readonly staleness?: string
}

export type DataQualityReport = {
  readonly fundamentals: DimensionQuality
  readonly news: DimensionQuality
  readonly technicals: DimensionQuality
  readonly ohlcv: DimensionQuality
  readonly overall: number // 0-1 weighted completeness
  readonly advisory: string // LLM-generated reliability note
}

export type EvidenceResult = {
  readonly agentName: string
  readonly valid: boolean
  readonly violations: readonly string[]
  readonly groundedEvidence: readonly string[]
  readonly ungroundedClaims: readonly string[]
}

export type Conflict = {
  readonly metric: string
  readonly bullClaim: string
  readonly bearClaim: string
  readonly isContradiction: boolean
  readonly severity: 'high' | 'medium' | 'low'
}

export type Resolution = {
  readonly conflict: Conflict
  readonly winner: 'bull' | 'bear' | 'both_valid'
  readonly reasoning: string
  readonly adjustedConfidence: { readonly bull: number; readonly bear: number }
}

export type ProposalValidation = {
  readonly valid: boolean
  readonly directionAligned: boolean
  readonly rrRatioValid: boolean
  readonly priceSane: boolean
  readonly confidenceConsistent: boolean
  readonly computedRR: number | null
  readonly violations: readonly string[]
}

export type CalibratedThresholds = {
  readonly calibratedAt: Date
  readonly sampleSize: number
  readonly calibrationConfidence: number
  readonly thresholds: {
    readonly strongBuy: number
    readonly buy: number
    readonly hold: readonly [number, number]
    readonly sell: number
    readonly strongSell: number
  }
  readonly dimensionWeights: Readonly<Record<string, number>>
}

export type FundamentalScores = {
  readonly valuation: number // 0-25
  readonly profitability: number // 0-25
  readonly financialHealth: number // 0-25
  readonly growth: number // 0-25
  readonly total: number // 0-100
  readonly availableMetrics: readonly string[]
  readonly missingMetrics: readonly string[]
}
