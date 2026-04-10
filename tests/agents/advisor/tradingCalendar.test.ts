import { describe, expect, it } from 'vitest'
import { nextTradingSessionDate, tradingDaysBetween } from '../../../src/agents/advisor/tradingCalendar.js'

describe('tradingCalendar', () => {
  it('skips weekends when computing the next session date', () => {
    const friday = new Date('2026-04-10T20:00:00.000Z')
    expect(nextTradingSessionDate(friday).toISOString()).toBe('2026-04-13T00:00:00.000Z')
  })

  it('counts weekday-only trading days between two timestamps', () => {
    const start = new Date('2026-04-07T00:00:00.000Z')
    const end = new Date('2026-04-14T00:00:00.000Z')
    expect(tradingDaysBetween(start, end)).toBe(5)
  })

  it('treats same-day boundaries as zero trading days', () => {
    const start = new Date('2026-04-07T00:00:00.000Z')
    const end = new Date('2026-04-07T00:00:00.000Z')
    expect(tradingDaysBetween(start, end)).toBe(0)
  })

  it('counts friday-to-monday as one trading day', () => {
    const friday = new Date('2026-04-10T00:00:00.000Z')
    const monday = new Date('2026-04-13T00:00:00.000Z')
    expect(tradingDaysBetween(friday, monday)).toBe(1)
  })
})
