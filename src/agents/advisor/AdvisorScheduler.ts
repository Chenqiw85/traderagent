// src/agents/advisor/AdvisorScheduler.ts

import cron from 'node-cron'
import type { AdvisorAgent } from './AdvisorAgent.js'
import type { WatchlistEntry } from './types.js'

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
    console.log(`[AdvisorScheduler] Starting with cron: ${this.cronExpression}`)
    console.log(`[AdvisorScheduler] Next run will execute at the scheduled time`)

    cron.schedule(this.cronExpression, () => {
      console.log(`[AdvisorScheduler] Cron fired at ${new Date().toISOString()}`)
      this.execute().catch((err) => {
        console.error(`[AdvisorScheduler] Run failed:`, err)
      })
    })
  }

  async execute(): Promise<void> {
    const watchlist = await this.getWatchlist()
    console.log(`[AdvisorScheduler] Running for ${watchlist.length} tickers`)
    await this.advisor.run(watchlist)
    console.log(`[AdvisorScheduler] Completed at ${new Date().toISOString()}`)
  }
}
