// src/rag/embedder.ts
import OpenAI from 'openai'

type EmbedderConfig = {
  apiKey: string
  model?: string   // default: 'text-embedding-3-small'
  baseURL?: string // allow alternative providers
}

/**
 * Embedder — wraps OpenAI-compatible embedding endpoints.
 * Produces vector embeddings for text chunks.
 */
export class Embedder {
  private client: OpenAI
  private model: string

  constructor(config: EmbedderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })
    this.model = config.model ?? 'text-embedding-3-small'
  }

  /** Embed a single text string. */
  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    })
    return response.data[0].embedding
  }

  /** Embed multiple texts in a single batch call. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    })
    // Sort by index to maintain order
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding)
  }
}
