import type { Market } from '../base/types.js'
import type { AdvisorForecastRepository, AdvisorForecastRow } from './AdvisorForecastRepository.js'
import { createLogger } from '../../utils/logger.js'
import { getErrorMessage } from '../../utils/errors.js'

const log = createLogger('ticker-accuracy')

const WINDOW = 20
const MIN_TOTAL_SAMPLES = 4
const MIN_BUCKET_SAMPLES = 2

export type BucketStats = {
  readonly promised: number
  readonly actual: number
  readonly n: number
}

export type TickerAccuracyStats = {
  readonly sampleSize: number
  readonly directionalHitRate: number
  readonly calibrationByBucket: {
    readonly high: BucketStats | null
    readonly moderate: BucketStats | null
    readonly low: BucketStats | null
  }
  readonly targetBandHitRate: number | null
}

type Deps = {
  readonly repository: Pick<AdvisorForecastRepository, 'findRecentScored'>
}

type BucketKey = 'high' | 'moderate' | 'low'

function bucketOf(confidence: number): BucketKey {
  if (confidence >= 0.70) return 'high'
  if (confidence >= 0.50) return 'moderate'
  return 'low'
}

function isValid(row: AdvisorForecastRow): boolean {
  return row.actualClose !== null
    && row.actualDirection !== null
    && row.predictedDirection !== 'abstain'
}

function computeBucket(rows: readonly AdvisorForecastRow[], key: BucketKey): BucketStats | null {
  const inBucket = rows.filter((r) => bucketOf(r.confidence) === key)
  if (inBucket.length < MIN_BUCKET_SAMPLES) return null
  const promised = inBucket.reduce((sum, r) => sum + r.confidence, 0) / inBucket.length
  const hits = inBucket.filter((r) => r.predictedDirection === r.actualDirection).length
  return { promised, actual: hits / inBucket.length, n: inBucket.length }
}

function computeTargetBandHitRate(rows: readonly AdvisorForecastRow[]): number | null {
  const banded = rows.filter((r) => r.atrRangeLow !== null && r.atrRangeHigh !== null)
  if (banded.length === 0) return null
  const hits = banded.filter((r) =>
    r.actualClose !== null
    && r.atrRangeLow !== null && r.atrRangeHigh !== null
    && r.actualClose >= r.atrRangeLow
    && r.actualClose <= r.atrRangeHigh,
  ).length
  return hits / banded.length
}

export class TickerAccuracyProvider {
  constructor(private readonly deps: Deps) {}

  async getStats(ticker: string, market: Market): Promise<TickerAccuracyStats | null> {
    try {
      const rows = await this.deps.repository.findRecentScored(ticker, market, WINDOW)
      const valid = rows.filter(isValid)
      if (valid.length < MIN_TOTAL_SAMPLES) return null

      const hits = valid.filter((r) => r.predictedDirection === r.actualDirection).length
      return {
        sampleSize: valid.length,
        directionalHitRate: hits / valid.length,
        calibrationByBucket: {
          high: computeBucket(valid, 'high'),
          moderate: computeBucket(valid, 'moderate'),
          low: computeBucket(valid, 'low'),
        },
        targetBandHitRate: computeTargetBandHitRate(valid),
      }
    } catch (err) {
      log.warn({ ticker, market, error: getErrorMessage(err) }, 'Failed to load accuracy stats')
      return null
    }
  }
}
