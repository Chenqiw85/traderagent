import { describe, it, expect } from 'vitest'
import { parseJson } from '../../src/utils/parseJson.js'

describe('parseJson', () => {
  it('parses a bare JSON object', () => {
    const result = parseJson<{ foo: string }>('{"foo":"bar"}')
    expect(result.foo).toBe('bar')
  })

  it('strips json markdown fences', () => {
    const result = parseJson<{ x: number }>('```json\n{"x": 42}\n```')
    expect(result.x).toBe(42)
  })

  it('strips plain code fences', () => {
    const result = parseJson<{ x: number }>('```\n{"x": 1}\n```')
    expect(result.x).toBe(1)
  })

  it('throws on invalid JSON', () => {
    expect(() => parseJson('not json')).toThrow()
  })
})
