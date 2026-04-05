import { beforeEach, describe, expect, it } from 'vitest'
import { detectRAGMode } from '../../src/config/config.js'

describe('detectRAGMode', () => {
  beforeEach(() => {
    delete process.env['OPENAI_API_KEY']
    delete process.env['QDRANT_URL']
    delete process.env['OLLAMA_HOST']
    delete process.env['RAG_BM25']
  })

  it('prefers qdrant when remote vector config is present', () => {
    process.env['OPENAI_API_KEY'] = 'test-key'
    process.env['QDRANT_URL'] = 'http://localhost:6333'

    expect(detectRAGMode()).toBe('qdrant')
  })

  it('uses memory mode for local offline BM25', () => {
    process.env['RAG_BM25'] = 'true'

    expect(detectRAGMode()).toBe('memory')
  })

  it('keeps ollama-host local mode mapped to memory', () => {
    process.env['OLLAMA_HOST'] = 'http://localhost:11434'

    expect(detectRAGMode()).toBe('memory')
  })
})
