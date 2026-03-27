import type { IVectorStore, Document, MetadataFilter } from './IVectorStore.js'

export class InMemoryVectorStore implements IVectorStore {
  private docs = new Map<string, Document>()

  async upsert(docs: Document[]): Promise<void> {
    for (const doc of docs) {
      this.docs.set(doc.id, doc)
    }
  }

  async search(query: number[], topK: number, filter?: MetadataFilter): Promise<Document[]> {
    let candidates = [...this.docs.values()]
    if (filter?.must) {
      for (const condition of filter.must) {
        candidates = candidates.filter((doc) => {
          for (const [key, value] of Object.entries(condition)) {
            if (doc.metadata?.[key] !== value) return false
          }
          return true
        })
      }
    }
    return candidates
      .filter((doc) => doc.embedding != null)
      .map((doc) => ({ doc, score: cosineSimilarity(query, doc.embedding!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.doc)
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) { this.docs.delete(id) }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}
