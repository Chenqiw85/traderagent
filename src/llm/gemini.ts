// src/llm/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'

type GeminiConfig = {
  apiKey: string
  model: string
}

export class GeminiProvider implements ILLMProvider {
  readonly name = 'gemini'
  private genAI: GoogleGenerativeAI
  private model: string

  constructor(config: GeminiConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey)
    this.model = config.model
  }

  private buildPrompt(messages: Message[]): string {
    return messages.map((m) => `${m.role}: ${m.content}`).join('\n')
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const geminiModel = this.genAI.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
        topP: options?.topP,
      },
    })
    const result = await geminiModel.generateContent(this.buildPrompt(messages))
    return result.response.text()
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    const geminiModel = this.genAI.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
        topP: options?.topP,
      },
    })
    const result = await geminiModel.generateContentStream(this.buildPrompt(messages))
    for await (const chunk of result.stream) {
      yield chunk.text()
    }
  }
}
