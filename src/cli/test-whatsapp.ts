// src/cli/test-whatsapp.ts — Quick test: send a WhatsApp message via Twilio
// Usage: npm run test:whatsapp

import { createTwilioSenderFromEnv } from '../messaging/TwilioWhatsAppSender.js'

const to = process.env['ADVISOR_WHATSAPP_TO']
if (!to) {
  console.error('Set ADVISOR_WHATSAPP_TO in .env (e.g. whatsapp:+1234567890)')
  process.exit(1)
}

try {
  const sender = createTwilioSenderFromEnv()
  await sender.send(to, '✅ TraderAgent Advisor — WhatsApp test successful!')
  console.log(`Message sent to ${to}`)
} catch (err) {
  console.error('Failed:', (err as Error).message)
  process.exit(1)
}
