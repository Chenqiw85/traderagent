// src/llm/ILLMProvider.ts

import type { Message, LLMOptions } from './types.js'

export interface ILLMProvider {
  readonly name: string
  chat(messages: Message[], options?: LLMOptions): Promise<string>
  chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string>
}
