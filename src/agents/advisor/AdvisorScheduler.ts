// src/agents/advisor/AdvisorScheduler.ts

import cron from 'node-cron'
import type { AdvisorAgent } from './AdvisorAgent.js'
import type { WatchlistEntry } from './types.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('advisor-scheduler')

const DEFAULT_CRON = '30 8 * * 1-5' // 8:30 AM ET, weekdays

export class AdvisorScheduler {
  private readonly cronExpression: string
  private readonly advisor: AdvisorAgent
  private readonly getWatchlist: () => Promise<readonly WatchlistEntry[]>

  constructor(config: {
    advisor: AdvisorAgent
    getWatchlist: () => Promise<readonly WatchlistEntry[]>
    cronExpression?: string
  }) {
    this.advisor = config.advisor
    this.getWatchlist = config.getWatchlist
    this.cronExpression = config.cronExpression ?? process.env['ADVISOR_CRON'] ?? DEFAULT_CRON
  }

  start(): void {
    if (!cron.validate(this.cronExpression)) {
      throw new Error(`Invalid cron expression: "${this.cronExpression}"`)
    }
    log.info({ cron: this.cronExpression }, 'Starting scheduler')

    cron.schedule(this.cronExpression, () => {
      log.info('Cron fired')
      this.execute().catch((err) => {
        log.error({ error: err }, 'Run failed')
      })
    })
  }

  async execute(): Promise<void> {
    const watchlist = await this.getWatchlist()
    log.info({ count: watchlist.length }, 'Running for tickers')
    await this.advisor.run(watchlist)
    log.info('Completed')
  }
}
