// src/llm/anthropic.ts
import Anthropic from '@anthropic-ai/sdk'
import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'
import { normalizeResponse } from './normalizeResponse.js'

type AnthropicConfig = {
  apiKey: string
  model: string
}

export class AnthropicProvider implements ILLMProvider {
  readonly name = 'anthropic'
  private client: Anthropic
  private model: string

  constructor(config: AnthropicConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey })
    this.model = config.model
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const systemMsg = messages.find((m) => m.role === 'system')?.content
    const userMessages = messages.filter((m) => m.role !== 'system')

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: systemMsg,
      messages: userMessages as Anthropic.MessageParam[],
      temperature: options?.temperature,
      top_p: options?.topP,
    })

    return normalizeResponse(response.content)
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    const systemMsg = messages.find((m) => m.role === 'system')?.content
    const userMessages = messages.filter((m) => m.role !== 'system')

    const stream = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: systemMsg,
      messages: userMessages as Anthropic.MessageParam[],
      stream: true,
      temperature: options?.temperature,
      top_p: options?.topP,
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }
  }
}
