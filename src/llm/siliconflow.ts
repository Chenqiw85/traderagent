// src/llm/siliconflow.ts
import { OpenAIProvider } from './openai.js'

type SiliconFlowConfig = {
  apiKey: string
  model: string
}

export class SiliconFlowProvider extends OpenAIProvider {
  override readonly name = 'siliconflow'

  constructor(config: SiliconFlowConfig) {
    super({
      apiKey: config.apiKey,
      model: config.model,
      baseURL: 'https://api.siliconflow.cn/v1',
    })
  }
}
