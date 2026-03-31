import { describe, it, expect } from 'vitest'
import { RateLimitError } from '../../src/data/errors.js'

describe('RateLimitError', () => {
  it('is an instance of Error', () => {
    const err = new RateLimitError('finnhub', 429)
    expect(err).toBeInstanceOf(Error)
  })

  it('stores source name and status code', () => {
    const err = new RateLimitError('finnhub', 429)
    expect(err.source).toBe('finnhub')
    expect(err.statusCode).toBe(429)
  })

  it('stores retryAfterMs when provided', () => {
    const err = new RateLimitError('finnhub', 429, 5000)
    expect(err.retryAfterMs).toBe(5000)
  })

  it('defaults retryAfterMs to undefined', () => {
    const err = new RateLimitError('finnhub', 429)
    expect(err.retryAfterMs).toBeUndefined()
  })

  it('has a descriptive message', () => {
    const err = new RateLimitError('finnhub', 429)
    expect(err.message).toBe('Rate limited by finnhub (HTTP 429)')
  })

  it('can be identified with isRateLimitError', () => {
    const err = new RateLimitError('finnhub', 429)
    expect(RateLimitError.isRateLimitError(err)).toBe(true)
    expect(RateLimitError.isRateLimitError(new Error('other'))).toBe(false)
  })
})
