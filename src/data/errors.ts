export class RateLimitError extends Error {
  readonly source: string
  readonly statusCode: number
  readonly retryAfterMs: number | undefined

  constructor(source: string, statusCode: number, retryAfterMs?: number) {
    super(`Rate limited by ${source} (HTTP ${statusCode})`)
    this.name = 'RateLimitError'
    this.source = source
    this.statusCode = statusCode
    this.retryAfterMs = retryAfterMs
  }

  static isRateLimitError(err: unknown): err is RateLimitError {
    return err instanceof RateLimitError
  }
}
