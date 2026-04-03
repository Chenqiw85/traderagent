// src/messaging/IMessageSender.ts

export interface IMessageSender {
  readonly name: string
  send(to: string, body: string): Promise<void>
}
