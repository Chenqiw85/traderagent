// src/agents/advisor/AdvisorScheduler.ts

import cron from 'node-cron'
import type { AdvisorAgent } from './AdvisorAgent.js'
import type { ForecastScorer } from './ForecastScorer.js'
import type { WatchlistEntry } from './types.js'
import { createLogger } from '../../utils/logger.js'
import { getErrorMessage } from '../../utils/errors.js'

const log = createLogger('advisor-scheduler')

const DEFAULT_CRON = '30 8 * * 1-5' // 08:30 ET, Mon-Fri (interpreted in SCORING_TIMEZONE)
// Scoring runs Mon-Fri at 16:05 ET (5 minutes after US equity market close).
// Evaluated in America/New_York so DST transitions are handled correctly.
const DEFAULT_SCORING_CRON = '5 16 * * 1-5'
const SCORING_TIMEZONE = 'America/New_York'

type SchedulerConfig = {
  advisor: AdvisorAgent
  getWatchlist: () => Promise<readonly WatchlistEntry[]>
  cronExpression?: string
  scorer?: ForecastScorer
  scoringCronExpression?: string
}

export class AdvisorScheduler {
  private readonly cronExpression: string
  private readonly scoringCronExpression: string
  private readonly advisor: AdvisorAgent
  private readonly getWatchlist: () => Promise<readonly WatchlistEntry[]>
  private readonly scorer?: ForecastScorer

  constructor(config: SchedulerConfig) {
    this.advisor = config.advisor
    this.getWatchlist = config.getWatchlist
    this.cronExpression = config.cronExpression ?? process.env['ADVISOR_CRON'] ?? DEFAULT_CRON
    this.scoringCronExpression = config.scoringCronExpression
      ?? process.env['ADVISOR_SCORING_CRON']
      ?? DEFAULT_SCORING_CRON
    this.scorer = config.scorer
  }

  start(): void {
    if (!cron.validate(this.cronExpression)) {
      throw new Error(`Invalid cron expression: "${this.cronExpression}"`)
    }
    log.info({ cron: this.cronExpression }, 'Starting advisor cron')

    cron.schedule(
      this.cronExpression,
      () => {
        log.info('Advisor cron fired')
        this.execute().catch((err) => {
          log.error({ error: getErrorMessage(err) }, 'Run failed')
        })
      },
      { timezone: SCORING_TIMEZONE },
    )

    if (this.scorer) {
      if (!cron.validate(this.scoringCronExpression)) {
        throw new Error(`Invalid scoring cron expression: "${this.scoringCronExpression}"`)
      }
      log.info({ cron: this.scoringCronExpression }, 'Starting scoring cron')
      cron.schedule(
        this.scoringCronExpression,
        () => {
          log.info('Scoring cron fired')
          this.runScoring().catch((err) =>
            log.error({ error: getErrorMessage(err) }, 'Scoring run failed'),
          )
        },
        { timezone: SCORING_TIMEZONE },
      )
    }
  }

  private async runScoring(): Promise<void> {
    if (!this.scorer) return
    const result = await this.scorer.scorePending(new Date())
    log.info(result, 'Scoring batch complete')
  }

  async execute(): Promise<void> {
    const watchlist = await this.getWatchlist()
    log.info({ count: watchlist.length }, 'Running for tickers')
    await this.advisor.run(watchlist)
    log.info('Completed')
  }
}
