function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function nextTradingSessionDate(asOf: Date): Date {
  const next = toUtcMidnight(asOf)
  next.setUTCDate(next.getUTCDate() + 1)
  while (isWeekend(next)) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next
}

export function tradingDaysBetween(start: Date, end: Date): number {
  let cursor = toUtcMidnight(start)
  const stop = toUtcMidnight(end)
  let count = 0

  while (cursor < stop) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (!isWeekend(cursor)) {
      count += 1
    }
  }

  return count
}
