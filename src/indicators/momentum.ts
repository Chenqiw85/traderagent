/** RSI using Wilder's smoothing method. */
export function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return NaN
  const changes = prices.slice(1).map((p, i) => p - prices[i])
  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  if (avgGain === 0 && avgLoss === 0) return 50
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** Stochastic Oscillator (%K and %D). %D = 3-period SMA of %K. */
export function calcStochastic(
  highs: number[], lows: number[], closes: number[],
  period = 14, smoothK = 3,
): { k: number; d: number } {
  const len = Math.min(highs.length, lows.length, closes.length)
  if (len < period) return { k: NaN, d: NaN }
  const kValues: number[] = []
  const count = Math.min(smoothK + period - 1, len)
  for (let end = len - count; end <= len - period; end++) {
    const windowHighs = highs.slice(end, end + period)
    const windowLows = lows.slice(end, end + period)
    const hh = Math.max(...windowHighs)
    const ll = Math.min(...windowLows)
    const close = closes[end + period - 1]
    const k = hh === ll ? 50 : ((close - ll) / (hh - ll)) * 100
    kValues.push(k)
  }
  const k = kValues[kValues.length - 1]
  const d = kValues.length >= smoothK
    ? kValues.slice(-smoothK).reduce((s, v) => s + v, 0) / smoothK
    : k
  return { k, d }
}
