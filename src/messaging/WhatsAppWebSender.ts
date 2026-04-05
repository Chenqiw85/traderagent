// src/messaging/WhatsAppWebSender.ts
// Direct WhatsApp Web connection via Baileys (WebSocket-based, no Twilio)

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { join } from 'node:path'
import type { IMessageSender } from './IMessageSender.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('whatsapp')

const WHATSAPP_MAX_LENGTH = 4096

type WhatsAppWebConfig = {
  readonly authDir: string // directory to store session credentials
}

export class WhatsAppWebSender implements IMessageSender {
  readonly name = 'whatsapp-web'
  private readonly authDir: string
  private socket: WASocket | undefined
  private connectionReady: Promise<void> | undefined
  private resolveReady: (() => void) | undefined
  private rejectReady: ((err: Error) => void) | undefined

  constructor(config: WhatsAppWebConfig) {
    if (!config.authDir) throw new Error('WhatsAppWebSender: missing authDir')
    this.authDir = config.authDir
  }

  async connect(): Promise<void> {
    if (this.socket) return this.connectionReady

    this.connectionReady = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      auth: state,
      defaultQueryTimeoutMs: 60_000,
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        log.info('Scan this QR code with your phone:')
        this.printQR(qr)
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut

        if (shouldReconnect) {
          log.info('Connection closed, reconnecting...')
          this.socket = undefined
          this.connect().catch((err) => {
            log.error({ error: (err as Error).message }, 'Reconnection failed')
          })
        } else {
          log.error('Logged out. Delete auth folder and re-scan QR.')
          this.rejectReady?.(new Error('WhatsApp logged out'))
        }
      } else if (connection === 'open') {
        log.info('Connected successfully')
        this.resolveReady?.()
      }
    })

    this.socket = sock
    return this.connectionReady
  }

  async send(to: string, body: string): Promise<void> {
    await this.connect()

    const jid = this.toJid(to)
    const chunks = this.splitMessage(body)

    for (const chunk of chunks) {
      await this.socket!.sendMessage(jid, { text: chunk })
    }
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      await this.socket.logout()
      this.socket = undefined
    }
  }

  /**
   * Render QR code string to terminal using Unicode block characters.
   * Each character in the qr string maps to a module; we use upper/lower
   * half-block pairs so two rows fit in one terminal line.
   */
  private printQR(qr: string): void {
    // Dynamic import to avoid hard dep — qrcode-terminal is bundled with baileys
    import('qrcode-terminal').then((mod) => {
      const generate = mod.default?.generate ?? mod.generate
      generate(qr, { small: true })
    }).catch(() => {
      // Fallback: just print the raw string so the user can paste it into a QR renderer
      log.info(qr)
    })
  }

  /**
   * Convert phone number to WhatsApp JID format.
   * Accepts: "+1234567890", "1234567890", "whatsapp:+1234567890"
   */
  private toJid(to: string): string {
    const cleaned = to
      .replace(/^whatsapp:/, '')
      .replace(/[^0-9]/g, '')
    return `${cleaned}@s.whatsapp.net`
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

export function createWhatsAppSenderFromEnv(): WhatsAppWebSender {
  const authDir = process.env['WHATSAPP_AUTH_DIR'] ?? join(process.cwd(), '.whatsapp-auth')
  return new WhatsAppWebSender({ authDir })
}
