// src/rag/qdrant.ts
import { QdrantClient } from '@qdrant/js-client-rest'
import type { IVectorStore, Document, MetadataFilter } from './IVectorStore.js'

type QdrantConfig = {
  url: string
  apiKey?: string
  collectionName: string
  vectorSize: number // dimension of embedding vectors
}

export class QdrantVectorStore implements IVectorStore {
  readonly name = 'qdrant'
  private client: QdrantClient
  private collectionName: string
  private vectorSize: number
  private collectionReady = false

  constructor(config: QdrantConfig) {
    this.client = new QdrantClient({
      url: config.url,
      apiKey: config.apiKey,
    })
    this.collectionName = config.collectionName
    this.vectorSize = config.vectorSize
  }

  /** Ensure collection exists — called lazily on first upsert or search */
  private async ensureCollection(): Promise<void> {
    if (this.collectionReady) return
    const collections = await this.client.getCollections()
    const exists = collections.collections.some((c) => c.name === this.collectionName)
    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: { size: this.vectorSize, distance: 'Cosine' },
      })
    }
    this.collectionReady = true
  }

  async upsert(docs: Document[]): Promise<void> {
    if (docs.length === 0) return
    await this.ensureCollection()

    const points = docs.map((doc) => ({
      id: doc.id,
      vector: doc.embedding ?? [],
      payload: {
        content: doc.content,
        ...doc.metadata,
      },
    }))

    await this.client.upsert(this.collectionName, { points })
  }

  async search(query: number[], topK: number, filter?: MetadataFilter): Promise<Document[]> {
    await this.ensureCollection()

    const qdrantFilter = filter?.must
      ? {
          must: filter.must.map((condition) => {
            const [key, value] = Object.entries(condition)[0]
            return { key, match: { value } }
          }),
        }
      : undefined

    const results = await this.client.search(this.collectionName, {
      vector: query,
      limit: topK,
      filter: qdrantFilter,
      with_payload: true,
    })

    return results.map((hit) => {
      const payload = (hit.payload ?? {}) as Record<string, unknown>
      const { content, ...metadata } = payload
      return {
        id: String(hit.id),
        content: (content as string) ?? '',
        metadata,
      }
    })
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.client.delete(this.collectionName, {
      points: ids,
    })
  }
}
