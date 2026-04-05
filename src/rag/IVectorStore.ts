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

export interface ITextSearchVectorStore extends IVectorStore {
  searchText(queryText: string, topK: number, filter?: MetadataFilter): Promise<Document[]>
}

export function supportsTextSearch(store: IVectorStore): store is ITextSearchVectorStore {
  return typeof (store as Partial<ITextSearchVectorStore>).searchText === 'function'
}
