// src/rag/chunker.ts

export type ChunkOptions = {
  chunkSize?: number  // max chars per chunk, default 1000
  overlap?: number    // overlap chars between chunks, default 200
}

export type Chunk = {
  text: string
  index: number
}

/**
 * Simple text chunker with overlapping windows.
 * Splits text into fixed-size chunks with configurable overlap.
 */
export function chunkText(text: string, options?: ChunkOptions): Chunk[] {
  const chunkSize = options?.chunkSize ?? 1000
  const overlap = options?.overlap ?? 200

  if (!text || text.length === 0) return []
  if (text.length <= chunkSize) {
    return [{ text, index: 0 }]
  }

  const chunks: Chunk[] = []
  let start = 0
  let index = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push({ text: text.slice(start, end), index })
    index++
    start += chunkSize - overlap
    if (start >= text.length) break
  }

  return chunks
}
