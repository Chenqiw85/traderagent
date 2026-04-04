import { Ollama } from 'ollama'
import type { IEmbedder } from './IEmbedder.js'

type OllamaEmbedderConfig = {
  model: string
  host?: string
}

export class OllamaEmbedder implements IEmbedder {
  private client: Ollama
  private model: string

  constructor(config: OllamaEmbedderConfig) {
    this.model = config.model
    this.client = new Ollama({ host: config.host ?? process.env['OLLAMA_HOST'] ?? 'http://localhost:11434' })
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embed({ model: this.model, input: text })
    return response.embeddings[0]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embed({ model: this.model, input: texts })
    return response.embeddings
  }
}
