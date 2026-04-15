import type { IDataSource } from '../../data/IDataSource.js'
import type { Market } from '../base/types.js'
import type { AdvisorForecastRepository, AdvisorForecastRow } from './AdvisorForecastRepository.js'
import { normalizeOhlcv } from '../../utils/normalizeOhlcv.js'
import { createLogger } from '../../utils/logger.js'
import { getErrorMessage } from '../../utils/errors.js'

const log = createLogger('forecast-scorer')

const FLAT_MOVE_THRESHOLD = 0.005
const MAX_LOOKAHEAD_DAYS = 3
const DAY_MS = 86_400_000

type ForecastScorerDeps = {
  readonly repository: Pick<AdvisorForecastRepository, 'findUnscored' | 'markScored'>
  readonly dataSource: IDataSource
}

export type ScoreBatchResult = {
  readonly scored: number
  readonly skipped: number
  readonly errors: number
}

function classifyDirection(reference: number, actual: number): 'up' | 'down' | 'flat' {
  if (!Number.isFinite(reference) || reference <= 0 || !Number.isFinite(actual)) return 'flat'
  const move = (actual - reference) / reference
  if (Math.abs(move) < FLAT_MOVE_THRESHOLD) return 'flat'
  return move > 0 ? 'up' : 'down'
}

async function findActualClose(
  deps: ForecastScorerDeps,
  row: AdvisorForecastRow,
): Promise<number | null> {
  for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset += 1) {
    const from = new Date(row.targetSession.getTime() + offset * DAY_MS)
    const to = new Date(from.getTime() + DAY_MS)
    const result = await deps.dataSource.fetch({
      ticker: row.ticker,
      market: row.market as Market,
      type: 'ohlcv',
      from,
      to,
    })
    const bars = normalizeOhlcv(result.data)
    const bar = bars.find((b) => {
      const barDate = b.date ? new Date(b.date) : null
      if (!barDate || Number.isNaN(barDate.getTime())) return false
      return barDate.toISOString().slice(0, 10) === from.toISOString().slice(0, 10)
    })
    if (bar && Number.isFinite(bar.close)) return bar.close
  }
  return null
}

export class ForecastScorer {
  constructor(private readonly deps: ForecastScorerDeps) {}

  async scorePending(now: Date): Promise<ScoreBatchResult> {
    const rows = await this.deps.repository.findUnscored(now)
    let scored = 0
    let errors = 0
    const skipped = 0

    for (const row of rows) {
      try {
        const actualClose = await findActualClose(this.deps, row)
        if (actualClose === null) {
          const ageMs = now.getTime() - row.targetSession.getTime()
          if (ageMs >= MAX_LOOKAHEAD_DAYS * DAY_MS) {
            await this.deps.repository.markScored(row.id, {
              actualClose: null,
              actualDirection: null,
              status: 'no-data',
            })
          }
          continue
        }
        const actualDirection = classifyDirection(row.referencePrice, actualClose)
        await this.deps.repository.markScored(row.id, {
          actualClose,
          actualDirection,
          status: 'scored',
        })
        scored += 1
      } catch (err) {
        errors += 1
        log.warn({ id: row.id, ticker: row.ticker, error: getErrorMessage(err) }, 'Failed to score forecast')
      }
    }

    return { scored, skipped, errors }
  }
}
