// src/rag/BM25Index.ts

/**
 * Pure TypeScript BM25 (Okapi BM25) implementation for offline text retrieval.
 * No external dependencies. Works as a local memory system when no embedding API is available.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'and',
  'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
  'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'only', 'same', 'than', 'too', 'very', 'just', 'that',
  'this', 'these', 'those', 'it', 'its',
])

type DocEntry = {
  id: string
  tokens: string[]
  termFreqs: Map<string, number>
  length: number
}

type SearchResult = {
  id: string
  score: number
}

export class BM25Index {
  /** BM25 tuning parameters */
  private readonly k1: number
  private readonly b: number

  private docs: Map<string, DocEntry> = new Map()
  /** Document frequency: how many docs contain each term */
  private df: Map<string, number> = new Map()
  private avgDocLength = 0

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1
    this.b = b
  }

  /** Add a document to the index */
  add(id: string, text: string): void {
    // Remove existing doc if updating
    if (this.docs.has(id)) {
      this.remove(id)
    }

    const tokens = this.tokenize(text)
    const termFreqs = new Map<string, number>()
    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1)
    }

    this.docs.set(id, { id, tokens, termFreqs, length: tokens.length })

    // Update document frequencies
    for (const term of termFreqs.keys()) {
      this.df.set(term, (this.df.get(term) ?? 0) + 1)
    }

    this.recalcAvgLength()
  }

  /** Remove a document from the index */
  remove(id: string): boolean {
    const doc = this.docs.get(id)
    if (!doc) return false

    // Decrement document frequencies
    for (const term of doc.termFreqs.keys()) {
      const current = this.df.get(term) ?? 0
      if (current <= 1) {
        this.df.delete(term)
      } else {
        this.df.set(term, current - 1)
      }
    }

    this.docs.delete(id)
    this.recalcAvgLength()
    return true
  }

  /** Search the index and return top-K results sorted by BM25 score */
  search(query: string, topK: number): SearchResult[] {
    const queryTokens = this.tokenize(query)
    if (queryTokens.length === 0 || this.docs.size === 0) return []

    const N = this.docs.size
    const scores: SearchResult[] = []

    for (const doc of this.docs.values()) {
      let score = 0

      for (const term of queryTokens) {
        const tf = doc.termFreqs.get(term) ?? 0
        if (tf === 0) continue

        const docFreq = this.df.get(term) ?? 0
        // IDF with smoothing to avoid negative values
        const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5))

        // BM25 term score
        const numerator = tf * (this.k1 + 1)
        const denominator = tf + this.k1 * (1 - this.b + this.b * (doc.length / this.avgDocLength))
        score += idf * (numerator / denominator)
      }

      if (score > 0) {
        scores.push({ id: doc.id, score })
      }
    }

    scores.sort((a, b) => b.score - a.score)
    return scores.slice(0, topK)
  }

  get size(): number {
    return this.docs.size
  }

  /** Tokenize text into lowercase terms, removing stop words and non-alpha chars */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
  }

  private recalcAvgLength(): void {
    if (this.docs.size === 0) {
      this.avgDocLength = 0
      return
    }
    let total = 0
    for (const doc of this.docs.values()) {
      total += doc.length
    }
    this.avgDocLength = total / this.docs.size
  }
}
