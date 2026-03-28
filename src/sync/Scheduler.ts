// src/sync/Scheduler.ts
import cron from 'node-cron'
import { DataSyncService } from './DataSyncService.js'
import { YFinanceSource } from '../data/yfinance.js'
import { FinnhubSource } from '../data/finnhub.js'

const DEFAULT_CRON = '30 16 * * 1-5' // 4:30 PM ET, weekdays

export class Scheduler {
  private cronExpression: string

  constructor(cronExpression?: string) {
    this.cronExpression = cronExpression ?? DEFAULT_CRON
  }

  start(): void {
    const sources = []
    if (process.env['FINNHUB_API_KEY']) {
      sources.push(new FinnhubSource())
    }
    sources.push(new YFinanceSource())

    const syncService = new DataSyncService(sources)

    console.log(`[Scheduler] Starting with cron: ${this.cronExpression}`)

    cron.schedule(this.cronExpression, () => {
      console.log(`[Scheduler] Cron fired at ${new Date().toISOString()}`)
      syncService.syncAll().catch((err) => {
        console.error('[Scheduler] Sync failed:', err)
      })
    })
  }
}
