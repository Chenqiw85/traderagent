/** On-Balance Volume. Adds volume on up-close days, subtracts on down-close days. */
export function calcOBV(closes: number[], volumes: number[]): number {
  const len = Math.min(closes.length, volumes.length)
  if (len < 2) return NaN
  let obv = 0
  for (let i = 1; i < len; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i]
    else if (closes[i] < closes[i - 1]) obv -= volumes[i]
  }
  return obv
}
