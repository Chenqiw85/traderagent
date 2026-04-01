// src/agents/trader/types.ts

import type { Decision, Market } from '../base/types.js'

export type ScoreBreakdown = {
  directional: number    // 0 or 1
  targetHit: number      // 0, 0.5, or 1
  calibration: number    // 0-1
  holdPenalty: number    // 0-1
}

export const SCORE_WEIGHTS = {
  directional: 0.3,
  targetHit: 0.3,
  calibration: 0.25,
  holdPenalty: 0.15,
} as const

export type ScoredDecision = {
  date: Date
  decision: Decision
  actualReturn: number
  hitTakeProfit: boolean
  hitStopLoss: boolean
  breakdown: ScoreBreakdown
  compositeScore: number
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

export type WindowResult = {
  label: string
  windowType: 'train' | 'test'
  totalDays: number
  winRate: number
  compositeScore: number
  decisions: ScoredDecision[]
}
