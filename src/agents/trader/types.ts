// src/agents/trader/types.ts

import type {
  ActionTier,
  Decision,
  LessonPerspective,
  LessonSource,
  LessonUsageSummary,
  Market,
} from '../base/types.js'
import type { CalibratedThresholds } from '../../types/quality.js'

export type OhlcvBar = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type ScoreBreakdown = {
  realizedTier: ActionTier
  exactTierHit: boolean
  tierDistanceScore: number
  directionalScore: number
  calibrationScore: number
  holdQualityScore: number
  riskExecutionScore: number
}

export const SCORE_WEIGHTS = {
  tierDistance: 0.3,
  directional: 0.2,
  calibration: 0.2,
  holdQuality: 0.1,
  riskExecution: 0.2,
} as const

export type ScoredDecision = {
  date: Date
  decision: Decision
  actualReturn: number
  hitTakeProfit: boolean
  hitStopLoss: boolean
  breakdown: ScoreBreakdown
  compositeScore: number
  lessonUsage?: LessonUsageSummary
}

export type LessonEntry = {
  id: string
  condition: string
  lesson: string
  evidence: string
  confidence: number
  passNumber: number
  ticker: string
  market: string
  source: LessonSource
  perspective: LessonPerspective
}

export type TrainConfig = {
  ticker: string
  market: Market
  maxPasses: number
  lookbackMonths: number
  evaluationDays: number
  earlyStopThreshold: number
  earlyStopPatience: number
}

export type WindowConfig = {
  trainStart: Date
  trainEnd: Date
  testStart: Date
  testEnd: Date
  label: string
}

export type PassResult = {
  passNumber: number
  windows: WindowResult[]
  avgTrainScore: number
  avgTestScore: number
  lessonCount: number
}

export type TrainResult = {
  passes: PassResult[]
  calibratedThresholds?: CalibratedThresholds
}

export type CalibrationBucket = {
  label: string
  minConfidence: number
  maxConfidence: number
  decisionCount: number
  exactTierHitRate: number
  directionalHitRate: number
  avgCompositeScore: number
}

export type LessonEffectiveness = {
  lessonId: string
  retrievalCount: number
  avgCompositeScore: number
}

export type CredibilitySummary = {
  exactTierHitRate: number
  directionalHitRate: number
  avgCompositeScore: number
  highConfidenceMissCount: number
  scoreWithLessons: number | null
  scoreWithoutLessons: number | null
  retrievalRateByAgent: Record<string, number>
  calibrationBuckets: CalibrationBucket[]
  helpfulLessons: LessonEffectiveness[]
  harmfulLessons: LessonEffectiveness[]
}

export type WindowResult = {
  label: string
  windowType: 'train' | 'test'
  totalDays: number
  winRate: number
  compositeScore: number
  decisions: ScoredDecision[]
  credibility: CredibilitySummary
}
