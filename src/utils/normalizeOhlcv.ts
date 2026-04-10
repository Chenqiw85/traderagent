/**
 * Shared OHLCV bar normalization utility.
 * Handles multiple data formats:
 * - Plain array of bar objects (various key casings)
 * - Yahoo Finance chart format: { quotes: [...] }
 * - Finnhub candle format: { s: 'ok', c: [], o: [], h: [], l: [], v: [], t: [] }
 */

export type OhlcvBar = {
  date?: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function barFromRecord(bar: Record<string, unknown>): OhlcvBar {
  return {
    date: bar.date != null
      ? String(bar.date)
      : bar.timestamp != null
        ? String(bar.timestamp)
        : undefined,
    open: Number(bar.open ?? bar.Open ?? 0),
    high: Number(bar.high ?? bar.High ?? 0),
    low: Number(bar.low ?? bar.Low ?? 0),
    close: Number(bar.close ?? bar.Close ?? bar.adjClose ?? 0),
    volume: Number(bar.volume ?? bar.Volume ?? 0),
  }
}

export function normalizeOhlcv(data: unknown): OhlcvBar[] {
  if (Array.isArray(data)) {
    return data.map((bar: Record<string, unknown>) => barFromRecord(bar))
  }

  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>

    // Yahoo Finance chart format
    if (Array.isArray(d.quotes)) {
      return (d.quotes as Record<string, unknown>[]).map(barFromRecord)
    }

    // Finnhub candle format
    if (d.s === 'ok' && Array.isArray(d.c)) {
      const c = d.c as number[]
      const o = d.o as number[]
      const h = d.h as number[]
      const l = d.l as number[]
      const v = d.v as number[]
      const t = d.t as number[] | undefined
      return c.map((_, i) => ({
        date: t?.[i] ? new Date(t[i] * 1000).toISOString() : undefined,
        open: o[i],
        high: h[i],
        low: l[i],
        close: c[i],
        volume: v[i],
      }))
    }

    // Single quote object fallback
    if (d.price != null) {
      return [{
        open: (d.open as number) ?? (d.price as number),
        high: (d.high as number) ?? (d.price as number),
        low: (d.low as number) ?? (d.price as number),
        close: d.price as number,
        volume: (d.volume as number) ?? 0,
      }]
    }
  }

  return []
}
