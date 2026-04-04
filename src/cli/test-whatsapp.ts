// src/cli/test-whatsapp.ts — Quick test: send a WhatsApp message via Baileys WebSocket
// Usage: npm run test:whatsapp

import { createWhatsAppSenderFromEnv } from '../messaging/WhatsAppWebSender.js'

const to = process.env['ADVISOR_WHATSAPP_TO']
if (!to) {
  console.error('Set ADVISOR_WHATSAPP_TO in .env (e.g. +1234567890)')
  process.exit(1)
}

try {
  const sender = createWhatsAppSenderFromEnv()
  await sender.connect()
  await sender.send(to, '✅ TraderAgent Advisor — WhatsApp test successful!')
  console.log(`Message sent to ${to}`)
  process.exit(0)
} catch (err) {
  console.error('Failed:', (err as Error).message)
  process.exit(1)
}
