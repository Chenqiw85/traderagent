/** Simple Moving Average of the last `period` values */
export function calcSMA(prices: number[], period: number): number {
  if (prices.length < period) return NaN
  const slice = prices.slice(-period)
  return slice.reduce((sum, p) => sum + p, 0) / period
}

/** Exponential Moving Average. Starts with SMA seed, then applies EMA formula. */
export function calcEMA(prices: number[], period: number): number {
  if (prices.length < period) return NaN
  const multiplier = 2 / (period + 1)
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * multiplier + ema * (1 - multiplier)
  }
  return ema
}

/** MACD: { line, signal, histogram }. Default periods: fast=12, slow=26, signal=9. */
export function calcMACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { line: number; signal: number; histogram: number } {
  if (prices.length < slowPeriod) {
    return { line: NaN, signal: NaN, histogram: NaN }
  }

  const fastMultiplier = 2 / (fastPeriod + 1)
  const slowMultiplier = 2 / (slowPeriod + 1)

  let fastEMA = prices.slice(0, fastPeriod).reduce((s, p) => s + p, 0) / fastPeriod
  let slowEMA = prices.slice(0, slowPeriod).reduce((s, p) => s + p, 0) / slowPeriod

  for (let i = fastPeriod; i < slowPeriod; i++) {
    fastEMA = prices[i] * fastMultiplier + fastEMA * (1 - fastMultiplier)
  }

  const macdSeries: number[] = []
  for (let i = slowPeriod; i < prices.length; i++) {
    fastEMA = prices[i] * fastMultiplier + fastEMA * (1 - fastMultiplier)
    slowEMA = prices[i] * slowMultiplier + slowEMA * (1 - slowMultiplier)
    macdSeries.push(fastEMA - slowEMA)
  }

  if (macdSeries.length < signalPeriod) {
    return { line: macdSeries[macdSeries.length - 1] ?? NaN, signal: NaN, histogram: NaN }
  }

  const sigMultiplier = 2 / (signalPeriod + 1)
  let signal = macdSeries.slice(0, signalPeriod).reduce((s, v) => s + v, 0) / signalPeriod
  for (let i = signalPeriod; i < macdSeries.length; i++) {
    signal = macdSeries[i] * sigMultiplier + signal * (1 - sigMultiplier)
  }

  const line = macdSeries[macdSeries.length - 1]
  return { line, signal, histogram: line - signal }
}
