/** Bollinger Bands: middle = SMA(period), upper/lower = middle +/- (stddev * numStdDev). */
export function calcBollinger(prices: number[], period = 20, numStdDev = 2): { upper: number; middle: number; lower: number } {
  if (prices.length < period) return { upper: NaN, middle: NaN, lower: NaN }
  const slice = prices.slice(-period)
  const middle = slice.reduce((s, p) => s + p, 0) / period
  const variance = slice.reduce((s, p) => s + (p - middle) ** 2, 0) / period
  const stddev = Math.sqrt(variance)
  return { upper: middle + numStdDev * stddev, middle, lower: middle - numStdDev * stddev }
}

/** Average True Range (ATR) using Wilder's smoothing. */
export function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  const len = Math.min(highs.length, lows.length, closes.length)
  if (len < period + 1) return NaN
  const trValues: number[] = []
  for (let i = 1; i < len; i++) {
    trValues.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
  }
  let atr = trValues.slice(0, period).reduce((s, v) => s + v, 0) / period
  for (let i = period; i < trValues.length; i++) {
    atr = (atr * (period - 1) + trValues[i]) / period
  }
  return atr
}

/** Annualized historical volatility from log returns. Assumes 252 trading days/year. */
export function calcHistoricalVolatility(prices: number[], tradingDays = 252): number {
  if (prices.length < 2) return NaN
  const returns: number[] = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] <= 0 || prices[i] <= 0) continue
    returns.push(Math.log(prices[i] / prices[i - 1]))
  }
  if (returns.length < 2) return NaN
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
  return Math.sqrt(variance) * Math.sqrt(tradingDays)
}
