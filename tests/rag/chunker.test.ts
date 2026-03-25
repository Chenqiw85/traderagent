// tests/rag/chunker.test.ts
import { describe, it, expect } from 'vitest'
import { chunkText } from '../../src/rag/chunker.js'

describe('chunkText', () => {
  it('returns empty array for empty text', () => {
    expect(chunkText('')).toEqual([])
  })

  it('returns single chunk for short text', () => {
    const result = chunkText('Hello world', { chunkSize: 100, overlap: 20 })
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('Hello world')
    expect(result[0].index).toBe(0)
  })

  it('splits long text into overlapping chunks', () => {
    const text = 'A'.repeat(250)
    const result = chunkText(text, { chunkSize: 100, overlap: 20 })
    expect(result.length).toBeGreaterThan(1)

    // Each chunk should be at most chunkSize
    result.forEach((chunk) => {
      expect(chunk.text.length).toBeLessThanOrEqual(100)
    })

    // Chunks should have sequential indices
    result.forEach((chunk, i) => {
      expect(chunk.index).toBe(i)
    })
  })

  it('overlap causes chunks to share content', () => {
    const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const result = chunkText(text, { chunkSize: 10, overlap: 3 })
    // Second chunk should start 7 chars into the string (10 - 3)
    expect(result[1].text.startsWith('HIJKLMNOPQ')).toBe(true)
  })

  it('uses default options when none provided', () => {
    const text = 'x'.repeat(2000)
    const result = chunkText(text)
    // With default chunkSize=1000 and overlap=200, 2000 chars → ~2 chunks
    expect(result.length).toBeGreaterThanOrEqual(2)
  })
})
