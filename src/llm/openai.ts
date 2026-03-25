// src/llm/openai.ts
import OpenAI from 'openai'
import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'

type OpenAIConfig = {
  apiKey: string
  model: string
  baseURL?: string
}

export class OpenAIProvider implements ILLMProvider {
  readonly name = 'openai'
  private client: OpenAI
  private model: string

  constructor(config: OpenAIConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
    this.model = config.model
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
    })
    return response.choices[0]?.message?.content ?? ''
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
    })
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) yield content
    }
  }
}
