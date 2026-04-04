// src/llm/ollama.ts
import { Ollama } from 'ollama'
import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'

type OllamaConfig = {
  host: string
  model: string
}

export class OllamaProvider implements ILLMProvider {
  readonly name = 'ollama'
  private client: Ollama
  private model: string

  constructor(config: OllamaConfig) {
    this.client = new Ollama({ host: config.host })
    this.model = config.model
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const response = await this.client.chat({
      model: this.model,
      messages,
      options: {
        temperature: options?.temperature,
        num_predict: options?.maxTokens,
        top_p: options?.topP,
      },
    })
    return response.message.content
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    const response = await this.client.chat({
      model: this.model,
      messages,
      stream: true,
      options: {
        temperature: options?.temperature,
        num_predict: options?.maxTokens,
        top_p: options?.topP,
      },
    })
    for await (const chunk of response) {
      yield chunk.message.content
    }
  }
}
