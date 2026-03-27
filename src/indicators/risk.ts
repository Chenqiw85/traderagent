/** Beta = Cov(stock, market) / Var(market). Takes daily returns arrays. */
export function calcBeta(stockReturns: number[], marketReturns: number[]): number {
  const len = Math.min(stockReturns.length, marketReturns.length)
  if (len < 2) return NaN
  const meanStock = stockReturns.slice(0, len).reduce((s, r) => s + r, 0) / len
  const meanMarket = marketReturns.slice(0, len).reduce((s, r) => s + r, 0) / len
  let covariance = 0
  let marketVariance = 0
  for (let i = 0; i < len; i++) {
    const dStock = stockReturns[i] - meanStock
    const dMarket = marketReturns[i] - meanMarket
    covariance += dStock * dMarket
    marketVariance += dMarket * dMarket
  }
  if (marketVariance === 0) return NaN
  return covariance / marketVariance
}

/** Max drawdown: largest peak-to-trough decline as positive decimal (0.25 = 25% drop). */
export function calcMaxDrawdown(prices: number[]): number {
  if (prices.length < 2) return NaN
  let peak = prices[0]
  let maxDD = 0
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > peak) peak = prices[i]
    else {
      const dd = (peak - prices[i]) / peak
      if (dd > maxDD) maxDD = dd
    }
  }
  return maxDD
}

/** Historical VaR using percentile method. Returns loss as positive number. */
export function calcVaR(returns: number[], confidence = 0.95): number {
  if (returns.length === 0) return NaN
  const sorted = [...returns].sort((a, b) => a - b)
  const index = Math.floor((1 - confidence) * sorted.length)
  return -sorted[Math.max(0, index)]
}
