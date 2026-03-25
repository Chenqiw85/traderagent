// src/llm/deepseek.ts
import { OpenAIProvider } from './openai.js'

type DeepSeekConfig = {
  apiKey: string
  model: string
}

export class DeepSeekProvider extends OpenAIProvider {
  override readonly name = 'deepseek'

  constructor(config: DeepSeekConfig) {
    super({
      apiKey: config.apiKey,
      model: config.model,
      baseURL: 'https://api.deepseek.com/v1',
    })
  }
}
