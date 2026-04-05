// src/cli/scheduler.ts
import { Scheduler } from '../sync/Scheduler.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('cli:scheduler')

const cronExpr = process.argv[2] // optional custom cron expression
const scheduler = new Scheduler(cronExpr)
scheduler.start()

log.info('Scheduler running. Press Ctrl+C to stop.')
