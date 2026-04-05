// src/rag/BM25VectorStore.ts

import type { Document, IVectorStore, MetadataFilter } from './IVectorStore.js'
import { BM25Index } from './BM25Index.js'

/**
 * IVectorStore implementation backed by BM25 text search.
 * Ignores embedding vectors entirely — uses keyword matching instead.
 * Useful as a RAG fallback when no embedding API is available.
 */
export class BM25VectorStore implements IVectorStore {
  private readonly index = new BM25Index()
  private readonly docs = new Map<string, Document>()

  /** Stores a query text for BM25 search (set before calling search()) */
  private lastQueryText = ''

  /**
   * Set the text query to use for the next search() call.
   * Since IVectorStore.search() takes a number[] embedding,
   * callers should call setQueryText() before search() to provide
   * the original text for BM25 matching.
   */
  setQueryText(text: string): void {
    this.lastQueryText = text
  }

  async upsert(docs: Document[]): Promise<void> {
    for (const doc of docs) {
      this.docs.set(doc.id, doc)
      this.index.add(doc.id, doc.content)
    }
  }

  async search(
    _query: number[],
    topK: number,
    filter?: MetadataFilter,
  ): Promise<Document[]> {
    // If no query text has been set, we can't do BM25 search
    if (!this.lastQueryText) return []

    // Search with a larger pool to allow for filtering
    const searchK = filter ? topK * 3 : topK
    const results = this.index.search(this.lastQueryText, searchK)

    const matched: Document[] = []
    for (const result of results) {
      const doc = this.docs.get(result.id)
      if (!doc) continue
      if (filter && !this.matchesFilter(doc, filter)) continue
      matched.push(doc)
      if (matched.length >= topK) break
    }

    return matched
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.docs.delete(id)
      this.index.remove(id)
    }
  }

  get size(): number {
    return this.docs.size
  }

  private matchesFilter(doc: Document, filter: MetadataFilter): boolean {
    if (!filter.must) return true
    return filter.must.every((condition) =>
      Object.entries(condition).every(
        ([key, value]) => doc.metadata[key] === value,
      ),
    )
  }
}
