// src/llm/types.ts

export type MessageRole = 'system' | 'user' | 'assistant'

export type Message = {
  role: MessageRole
  content: string
}

export type LLMOptions = {
  temperature?: number   // 0–2, default 0.7
  maxTokens?: number
  topP?: number
}
