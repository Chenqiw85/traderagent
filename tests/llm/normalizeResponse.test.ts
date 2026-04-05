import { describe, it, expect } from 'vitest'
import { normalizeResponse } from '../../src/llm/normalizeResponse.js'

describe('normalizeResponse', () => {
  it('passes through plain strings', () => {
    expect(normalizeResponse('hello')).toBe('hello')
  })

  it('returns empty string for null/undefined', () => {
    expect(normalizeResponse(null)).toBe('')
    expect(normalizeResponse(undefined)).toBe('')
  })

  it('extracts text from Anthropic content blocks', () => {
    const blocks = [
      { type: 'thinking', text: 'internal reasoning...' },
      { type: 'text', text: 'The answer is 42.' },
    ]
    expect(normalizeResponse(blocks)).toBe('The answer is 42.')
  })

  it('handles array of text-only blocks', () => {
    const blocks = [
      { type: 'text', text: 'Part 1. ' },
      { type: 'text', text: 'Part 2.' },
    ]
    expect(normalizeResponse(blocks)).toBe('Part 1. Part 2.')
  })

  it('handles wrapped content array', () => {
    const response = {
      content: [{ type: 'text', text: 'Wrapped text' }],
    }
    expect(normalizeResponse(response)).toBe('Wrapped text')
  })

  it('handles simple text wrapper object', () => {
    expect(normalizeResponse({ text: 'simple' })).toBe('simple')
  })

  it('handles simple content wrapper object', () => {
    expect(normalizeResponse({ content: 'direct content' })).toBe('direct content')
  })

  it('handles OpenAI chat completion format', () => {
    const response = { message: { content: 'openai response' } }
    expect(normalizeResponse(response)).toBe('openai response')
  })

  it('falls back to JSON.stringify for unknown objects', () => {
    const response = { foo: 'bar' }
    expect(normalizeResponse(response)).toBe('{"foo":"bar"}')
  })

  it('converts numbers to string', () => {
    expect(normalizeResponse(42)).toBe('42')
  })
})
