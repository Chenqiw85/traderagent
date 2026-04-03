// src/messaging/TwilioWhatsAppSender.ts

import type { IMessageSender } from './IMessageSender.js'

type TwilioConfig = {
  readonly accountSid: string
  readonly authToken: string
  readonly from: string // e.g. "whatsapp:+14155238886"
}

const WHATSAPP_MAX_LENGTH = 4096

export class TwilioWhatsAppSender implements IMessageSender {
  readonly name = 'twilio-whatsapp'
  private readonly config: TwilioConfig

  constructor(config: TwilioConfig) {
    if (!config.accountSid) throw new Error('TwilioWhatsAppSender: missing accountSid')
    if (!config.authToken) throw new Error('TwilioWhatsAppSender: missing authToken')
    if (!config.from) throw new Error('TwilioWhatsAppSender: missing from number')
    this.config = config
  }

  async send(to: string, body: string): Promise<void> {
    const chunks = this.splitMessage(body)
    for (const chunk of chunks) {
      await this.sendChunk(to, chunk)
    }
  }

  private async sendChunk(to: string, body: string): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`
    const params = new URLSearchParams({
      To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      From: this.config.from,
      Body: body,
    })

    const credentials = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(`Twilio API error (${response.status}): ${errorBody}`)
    }
  }

  private splitMessage(body: string): string[] {
    if (body.length <= WHATSAPP_MAX_LENGTH) return [body]

    const chunks: string[] = []
    const lines = body.split('\n')
    let current = ''

    for (const line of lines) {
      if (current.length + line.length + 1 > WHATSAPP_MAX_LENGTH) {
        if (current.length > 0) chunks.push(current)
        current = line
      } else {
        current = current.length > 0 ? `${current}\n${line}` : line
      }
    }
    if (current.length > 0) chunks.push(current)

    return chunks
  }
}

export function createTwilioSenderFromEnv(): TwilioWhatsAppSender {
  const accountSid = process.env['TWILIO_ACCOUNT_SID']
  const authToken = process.env['TWILIO_AUTH_TOKEN']
  const from = process.env['TWILIO_WHATSAPP_FROM']
  if (!accountSid || !authToken || !from) {
    throw new Error(
      'Missing Twilio env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM'
    )
  }
  return new TwilioWhatsAppSender({ accountSid, authToken, from })
}
