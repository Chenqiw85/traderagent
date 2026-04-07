export type RateLimitConfig = {
  /** Max requests per interval */
  intervalCap: number
  /** Interval duration in milliseconds */
  intervalMs: number
  /** Max concurrent requests */
  concurrency: number
}

export const rateLimitDefaults: Record<string, RateLimitConfig> = {
  finnhub:   { intervalCap: 55,  intervalMs: 60_000,      concurrency: 1 },
  yfinance:  { intervalCap: 80,  intervalMs: 60_000,      concurrency: 2 },
  polygon:   { intervalCap: 5,   intervalMs: 1_000,       concurrency: 2 },
  newsapi:   { intervalCap: 90,  intervalMs: 86_400_000,  concurrency: 1 },
  secedgar:  { intervalCap: 9,   intervalMs: 1_000,       concurrency: 1 },
}
