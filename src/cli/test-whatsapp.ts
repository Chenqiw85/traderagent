// src/cli/test-whatsapp.ts — Quick test: send a WhatsApp message via Baileys WebSocket
// Usage: npm run test:whatsapp

import { createWhatsAppSenderFromEnv } from '../messaging/WhatsAppWebSender.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('cli:test-whatsapp')

const to = process.env['ADVISOR_WHATSAPP_TO']
if (!to) {
  log.error('Set ADVISOR_WHATSAPP_TO in .env (e.g. +1234567890)')
  process.exit(1)
}

try {
  const sender = createWhatsAppSenderFromEnv()
  await sender.connect()
  await sender.send(to, 'TraderAgent Advisor — WhatsApp test successful!')
  log.info({ to }, 'Message sent')
  process.exit(0)
} catch (err) {
  log.error({ error: (err as Error).message }, 'Failed')
  process.exit(1)
}
