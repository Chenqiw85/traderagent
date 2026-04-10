import { describe, it, expect } from 'vitest'
import type { LessonRetrievalEvent } from '../../../src/agents/base/types.js'
import { summarizeCredibility, summarizeLessonUsage } from '../../../src/agents/trader/CredibilityAnalyzer.js'
import type { ScoredDecision } from '../../../src/agents/trader/types.js'

function makeDecision(overrides: Partial<ScoredDecision> = {}): ScoredDecision {
  return {
    date: new Date('2025-06-15T00:00:00.000Z'),
    decision: {
      action: 'BUY',
      confidence: 0.8,
      reasoning: 'test',
    },
    actualReturn: 0.05,
    hitTakeProfit: false,
    hitStopLoss: false,
    breakdown: {
      realizedTier: 'BUY',
      exactTierHit: true,
      tierDistanceScore: 1,
      directionalScore: 1,
      calibrationScore: 0.8,
      holdQualityScore: 1,
      riskExecutionScore: 0.5,
    },
    compositeScore: 0.86,
    ...overrides,
  }
}

describe('CredibilityAnalyzer', () => {
  it('summarizes lesson retrieval usage by agent and lesson frequency', () => {
    const events: LessonRetrievalEvent[] = [
      {
        lessonId: 'lesson-a',
        agent: 'bull',
        perspective: 'bull',
        source: 'extractor',
        ticker: 'AAPL',
        market: 'US',
        asOf: new Date('2025-06-01T00:00:00.000Z'),
        query: 'bull setup',
        rank: 1,
      },
      {
        lessonId: 'lesson-b',
        agent: 'bull',
        perspective: 'bull',
        source: 'extractor',
        ticker: 'AAPL',
        market: 'US',
        asOf: new Date('2025-06-01T00:00:00.000Z'),
        query: 'bull setup',
        rank: 2,
      },
      {
        lessonId: 'lesson-a',
        agent: 'bull',
        perspective: 'bull',
        source: 'extractor',
        ticker: 'AAPL',
        market: 'US',
        asOf: new Date('2025-06-01T00:00:00.000Z'),
        query: 'bull setup',
        rank: 3,
      },
      {
        lessonId: 'lesson-a',
        agent: 'manager',
        perspective: 'manager',
        source: 'reflection',
        ticker: 'AAPL',
        market: 'US',
        asOf: new Date('2025-06-01T00:00:00.000Z'),
        query: 'manager setup',
        rank: 1,
      },
    ]

    expect(summarizeLessonUsage(events)).toEqual({
      retrievedCount: 4,
      retrievedByAgent: {
        bull: 3,
        manager: 1,
      },
      retrievalCountByLesson: {
        'lesson-a': 3,
        'lesson-b': 1,
      },
      topLessonIds: ['lesson-a', 'lesson-b'],
    })
  })

  it('summarizes credibility, calibration, and lesson effectiveness across decisions', () => {
    const decisions: ScoredDecision[] = [
      makeDecision({
        decision: {
          action: 'BUY',
          confidence: 0.9,
          reasoning: 'strong breakout',
        },
        lessonUsage: {
          retrievedCount: 3,
          retrievedByAgent: { bull: 3 },
          retrievalCountByLesson: { 'lesson-a': 3 },
          topLessonIds: ['lesson-a'],
        },
        compositeScore: 0.9,
      }),
      makeDecision({
        decision: {
          action: 'SELL',
          confidence: 0.85,
          reasoning: 'failed support',
        },
        breakdown: {
          realizedTier: 'OVERWEIGHT',
          exactTierHit: false,
          tierDistanceScore: 0.25,
          directionalScore: 0,
          calibrationScore: 0.15,
          holdQualityScore: 1,
          riskExecutionScore: 0.25,
        },
        lessonUsage: {
          retrievedCount: 2,
          retrievedByAgent: { manager: 2 },
          retrievalCountByLesson: { 'lesson-a': 2 },
          topLessonIds: ['lesson-a'],
        },
        compositeScore: 0.85,
      }),
      makeDecision({
        decision: {
          action: 'HOLD',
          confidence: 0.35,
          reasoning: 'mixed signals',
        },
        breakdown: {
          realizedTier: 'UNDERWEIGHT',
          exactTierHit: false,
          tierDistanceScore: 0.75,
          directionalScore: 0.5,
          calibrationScore: 0.65,
          holdQualityScore: 0,
          riskExecutionScore: 0.5,
        },
        lessonUsage: {
          retrievedCount: 4,
          retrievedByAgent: { bull: 4 },
          retrievalCountByLesson: { 'lesson-b': 4 },
          topLessonIds: ['lesson-b'],
        },
        compositeScore: 0.4,
      }),
    ]

    expect(summarizeCredibility(decisions)).toEqual({
      exactTierHitRate: 1 / 3,
      directionalHitRate: 1 / 3,
      avgCompositeScore: 0.7167,
      highConfidenceMissCount: 1,
      scoreWithLessons: 0.7167,
      scoreWithoutLessons: null,
      retrievalRateByAgent: {
        bull: 2 / 3,
        manager: 1 / 3,
      },
      calibrationBuckets: [
        {
          label: '0.00-0.19',
          minConfidence: 0,
          maxConfidence: 0.19,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.20-0.39',
          minConfidence: 0.2,
          maxConfidence: 0.39,
          decisionCount: 1,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0.4,
        },
        {
          label: '0.40-0.59',
          minConfidence: 0.4,
          maxConfidence: 0.59,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.60-0.79',
          minConfidence: 0.6,
          maxConfidence: 0.79,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.80-1.00',
          minConfidence: 0.8,
          maxConfidence: 1,
          decisionCount: 2,
          exactTierHitRate: 0.5,
          directionalHitRate: 0.5,
          avgCompositeScore: 0.875,
        },
      ],
      helpfulLessons: [
        {
          lessonId: 'lesson-a',
          retrievalCount: 5,
          avgCompositeScore: 0.88,
        },
      ],
      harmfulLessons: [
        {
          lessonId: 'lesson-b',
          retrievalCount: 4,
          avgCompositeScore: 0.4,
        },
      ],
    })
  })

  it('returns a fully populated empty credibility summary when no decisions are provided', () => {
    expect(summarizeCredibility([])).toEqual({
      exactTierHitRate: 0,
      directionalHitRate: 0,
      avgCompositeScore: 0,
      highConfidenceMissCount: 0,
      scoreWithLessons: null,
      scoreWithoutLessons: null,
      retrievalRateByAgent: {},
      calibrationBuckets: [
        {
          label: '0.00-0.19',
          minConfidence: 0,
          maxConfidence: 0.19,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.20-0.39',
          minConfidence: 0.2,
          maxConfidence: 0.39,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.40-0.59',
          minConfidence: 0.4,
          maxConfidence: 0.59,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.60-0.79',
          minConfidence: 0.6,
          maxConfidence: 0.79,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
        {
          label: '0.80-1.00',
          minConfidence: 0.8,
          maxConfidence: 1,
          decisionCount: 0,
          exactTierHitRate: 0,
          directionalHitRate: 0,
          avgCompositeScore: 0,
        },
      ],
      helpfulLessons: [],
      harmfulLessons: [],
    })
  })

  it('returns null for missing lesson cohorts on non-empty decision sets', () => {
    const withLessonsOnly = summarizeCredibility([
      makeDecision({
        lessonUsage: {
          retrievedCount: 2,
          retrievedByAgent: { bull: 2 },
          retrievalCountByLesson: { 'lesson-a': 2 },
          topLessonIds: ['lesson-a'],
        },
      }),
    ])

    const withoutLessonsOnly = summarizeCredibility([
      makeDecision({
        lessonUsage: {
          retrievedCount: 0,
          retrievedByAgent: {},
          retrievalCountByLesson: {},
          topLessonIds: [],
        },
      }),
    ])

    expect(withLessonsOnly.scoreWithLessons).toBe(0.86)
    expect(withLessonsOnly.scoreWithoutLessons).toBeNull()
    expect(withoutLessonsOnly.scoreWithLessons).toBeNull()
    expect(withoutLessonsOnly.scoreWithoutLessons).toBe(0.86)
  })

  it('classifies lessons against the lesson-backed baseline instead of all decisions', () => {
    const summary = summarizeCredibility([
      makeDecision({
        lessonUsage: {
          retrievedCount: 2,
          retrievedByAgent: { bull: 2 },
          retrievalCountByLesson: { 'lesson-a': 2 },
          topLessonIds: ['lesson-a'],
        },
        compositeScore: 0.6,
      }),
      makeDecision({
        lessonUsage: {
          retrievedCount: 1,
          retrievedByAgent: { manager: 1 },
          retrievalCountByLesson: { 'lesson-b': 1 },
          topLessonIds: ['lesson-b'],
        },
        compositeScore: 0.3,
      }),
      makeDecision({
        lessonUsage: {
          retrievedCount: 0,
          retrievedByAgent: {},
          retrievalCountByLesson: {},
          topLessonIds: [],
        },
        compositeScore: 0.95,
      }),
    ])

    expect(summary.helpfulLessons).toEqual([
      {
        lessonId: 'lesson-a',
        retrievalCount: 2,
        avgCompositeScore: 0.6,
      },
    ])
    expect(summary.harmfulLessons).toEqual([
      {
        lessonId: 'lesson-b',
        retrievalCount: 1,
        avgCompositeScore: 0.3,
      },
    ])
  })
})
