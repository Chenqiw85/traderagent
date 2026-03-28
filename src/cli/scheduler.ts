// src/cli/scheduler.ts
import { Scheduler } from '../sync/Scheduler.js'

const cronExpr = process.argv[2] // optional custom cron expression
const scheduler = new Scheduler(cronExpr)
scheduler.start()

console.log('Scheduler running. Press Ctrl+C to stop.')
