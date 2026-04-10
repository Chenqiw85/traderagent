import { ACTION_DIRECTION, type LessonRetrievalEvent, type LessonUsageSummary } from '../base/types.js'
import type {
  CalibrationBucket,
  CredibilitySummary,
  LessonEffectiveness,
  ScoredDecision,
} from './types.js'

const CALIBRATION_BUCKETS: ReadonlyArray<Pick<CalibrationBucket, 'label' | 'minConfidence' | 'maxConfidence'>> = [
  { label: '0.00-0.19', minConfidence: 0, maxConfidence: 0.19 },
  { label: '0.20-0.39', minConfidence: 0.2, maxConfidence: 0.39 },
  { label: '0.40-0.59', minConfidence: 0.4, maxConfidence: 0.59 },
  { label: '0.60-0.79', minConfidence: 0.6, maxConfidence: 0.79 },
  { label: '0.80-1.00', minConfidence: 0.8, maxConfidence: 1 },
]

const HIGH_CONFIDENCE_THRESHOLD = 0.8

function roundAverage(value: number): number
function roundAverage(value: number | null): number | null
function roundAverage(value: number | null): number | null {
  if (value === null) return null
  return Number(value.toFixed(4))
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function averageOrNull(values: number[]): number | null {
  if (values.length === 0) return null
  return average(values)
}

function buildEmptyBuckets(): CalibrationBucket[] {
  return CALIBRATION_BUCKETS.map((bucket) => ({
    ...bucket,
    decisionCount: 0,
    exactTierHitRate: 0,
    directionalHitRate: 0,
    avgCompositeScore: 0,
  }))
}

function isDirectionalHit(decision: ScoredDecision): boolean {
  const expectedDirection = ACTION_DIRECTION[decision.decision.action]
  const realizedDirection = ACTION_DIRECTION[decision.breakdown.realizedTier]

  if (expectedDirection === 0 || realizedDirection === 0) {
    return expectedDirection === realizedDirection
  }

  return Math.sign(expectedDirection) === Math.sign(realizedDirection)
}

function summarizeLessonEffectiveness(
  decisions: ScoredDecision[],
  baselineAverage: number,
  comparator: (avgScore: number, baseline: number) => boolean,
  sortDirection: 'asc' | 'desc',
): LessonEffectiveness[] {
  const lessonToStats = new Map<string, { retrievalCount: number; weightedCompositeScore: number }>()

  for (const decision of decisions) {
    const retrievalCountByLesson = decision.lessonUsage?.retrievalCountByLesson ?? {}
    for (const [lessonId, retrievalCount] of Object.entries(retrievalCountByLesson)) {
      if (retrievalCount <= 0) continue

      const stats = lessonToStats.get(lessonId) ?? {
        retrievalCount: 0,
        weightedCompositeScore: 0,
      }
      stats.retrievalCount += retrievalCount
      stats.weightedCompositeScore += decision.compositeScore * retrievalCount
      lessonToStats.set(lessonId, stats)
    }
  }

  return [...lessonToStats.entries()]
    .map(([lessonId, stats]) => {
      const rawAverage = stats.weightedCompositeScore / stats.retrievalCount
      return {
        lessonId,
        retrievalCount: stats.retrievalCount,
        rawAverage,
        avgCompositeScore: roundAverage(rawAverage),
      }
    })
    .filter((lesson) => comparator(lesson.rawAverage, baselineAverage))
    .sort((left, right) => {
      if (left.avgCompositeScore !== right.avgCompositeScore) {
        return sortDirection === 'desc'
          ? right.avgCompositeScore - left.avgCompositeScore
          : left.avgCompositeScore - right.avgCompositeScore
      }
      if (left.retrievalCount !== right.retrievalCount) {
        return right.retrievalCount - left.retrievalCount
      }
      return left.lessonId.localeCompare(right.lessonId)
    })
    .map(({ lessonId, retrievalCount, avgCompositeScore }) => ({
      lessonId,
      retrievalCount,
      avgCompositeScore,
    }))
}

function weightedLessonDecisionAverage(decisions: ScoredDecision[]): number | null {
  let weightedScore = 0
  let totalRetrievals = 0

  for (const decision of decisions) {
    const retrievals = decision.lessonUsage?.retrievedCount ?? 0
    if (retrievals <= 0) continue

    weightedScore += decision.compositeScore * retrievals
    totalRetrievals += retrievals
  }

  if (totalRetrievals === 0) return null
  return weightedScore / totalRetrievals
}

export function summarizeLessonUsage(events: LessonRetrievalEvent[]): LessonUsageSummary {
  if (events.length === 0) {
    return {
      retrievedCount: 0,
      retrievedByAgent: {},
      retrievalCountByLesson: {},
      topLessonIds: [],
    }
  }

  const retrievedByAgent: Record<string, number> = {}
  const retrievalCountByLesson: Record<string, number> = {}

  for (const event of events) {
    retrievedByAgent[event.agent] = (retrievedByAgent[event.agent] ?? 0) + 1
    retrievalCountByLesson[event.lessonId] = (retrievalCountByLesson[event.lessonId] ?? 0) + 1
  }

  const topLessonIds = Object.entries(retrievalCountByLesson)
    .sort((left, right) => {
      if (left[1] !== right[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
    .map(([lessonId]) => lessonId)

  return {
    retrievedCount: events.length,
    retrievedByAgent,
    retrievalCountByLesson,
    topLessonIds,
  }
}

export function summarizeCredibility(decisions: ScoredDecision[]): CredibilitySummary {
  if (decisions.length === 0) {
    return {
      exactTierHitRate: 0,
      directionalHitRate: 0,
      avgCompositeScore: 0,
      highConfidenceMissCount: 0,
      scoreWithLessons: null,
      scoreWithoutLessons: null,
      retrievalRateByAgent: {},
      calibrationBuckets: buildEmptyBuckets(),
      helpfulLessons: [],
      harmfulLessons: [],
    }
  }

  const exactHits = decisions.filter((decision) => decision.breakdown.exactTierHit).length
  const directionalHits = decisions.filter(isDirectionalHit).length
  const overallAverage = average(decisions.map((decision) => decision.compositeScore))
  const decisionsWithLessons = decisions.filter((decision) => (decision.lessonUsage?.retrievedCount ?? 0) > 0)
  const decisionsWithoutLessons = decisions.filter((decision) => (decision.lessonUsage?.retrievedCount ?? 0) === 0)
  const lessonBackedAverage = weightedLessonDecisionAverage(decisionsWithLessons)
  const retrievalDecisionCounts = new Map<string, number>()

  for (const decision of decisions) {
    const agents = Object.entries(decision.lessonUsage?.retrievedByAgent ?? {})
      .filter(([, count]) => count > 0)
      .map(([agent]) => agent)

    for (const agent of agents) {
      retrievalDecisionCounts.set(agent, (retrievalDecisionCounts.get(agent) ?? 0) + 1)
    }
  }

  const retrievalRateByAgent = Object.fromEntries(
    [...retrievalDecisionCounts.entries()]
      .sort(([leftAgent], [rightAgent]) => leftAgent.localeCompare(rightAgent))
      .map(([agent, count]) => [agent, count / decisions.length]),
  )

  const calibrationBuckets = buildEmptyBuckets().map((bucket, index) => {
    const bucketDecisions = decisions.filter((decision) => {
      const confidence = Math.max(0, Math.min(1, decision.decision.confidence))
      const bucketIndex = confidence === 1 ? CALIBRATION_BUCKETS.length - 1 : Math.floor(confidence * 5)
      return bucketIndex === index
    })

    if (bucketDecisions.length === 0) return bucket

    return {
      ...bucket,
      decisionCount: bucketDecisions.length,
      exactTierHitRate:
        bucketDecisions.filter((decision) => decision.breakdown.exactTierHit).length / bucketDecisions.length,
      directionalHitRate:
        bucketDecisions.filter(isDirectionalHit).length / bucketDecisions.length,
      avgCompositeScore: roundAverage(average(bucketDecisions.map((decision) => decision.compositeScore))),
    }
  })

  return {
    exactTierHitRate: exactHits / decisions.length,
    directionalHitRate: directionalHits / decisions.length,
    avgCompositeScore: roundAverage(overallAverage),
    highConfidenceMissCount: decisions.filter(
      (decision) => decision.decision.confidence >= HIGH_CONFIDENCE_THRESHOLD && !isDirectionalHit(decision),
    ).length,
    scoreWithLessons: roundAverage(averageOrNull(decisionsWithLessons.map((decision) => decision.compositeScore))),
    scoreWithoutLessons: roundAverage(averageOrNull(decisionsWithoutLessons.map((decision) => decision.compositeScore))),
    retrievalRateByAgent,
    calibrationBuckets,
    helpfulLessons:
      lessonBackedAverage == null
        ? []
        : summarizeLessonEffectiveness(decisionsWithLessons, lessonBackedAverage, (avg, baseline) => avg > baseline, 'desc'),
    harmfulLessons:
      lessonBackedAverage == null
        ? []
        : summarizeLessonEffectiveness(decisionsWithLessons, lessonBackedAverage, (avg, baseline) => avg < baseline, 'asc'),
  }
}
