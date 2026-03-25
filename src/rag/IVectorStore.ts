// src/rag/IVectorStore.ts

export type Document = {
  id: string
  content: string
  embedding?: number[]
  metadata: Record<string, unknown>
}

export type MetadataFilter = {
  must?: Record<string, unknown>[]
}

export interface IVectorStore {
  upsert(docs: Document[]): Promise<void>
  search(query: number[], topK: number, filter?: MetadataFilter): Promise<Document[]>
  delete(ids: string[]): Promise<void>
}
