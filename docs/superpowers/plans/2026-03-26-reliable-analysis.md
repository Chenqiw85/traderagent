# Reliable Analysis Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the trading agent produce evidence-grounded analysis by fixing data reliability, adding computed indicators, activating RAG, and enforcing hard failures on missing data.

**Architecture:** A new `FallbackDataSource` wraps multiple data sources with retry. A `TechnicalAnalyzer` stage computes real indicators (RSI, MACD, Bollinger, etc.) from raw OHLCV before researchers run. Agents hard-fail if critical data is missing. RAG is configurable: Qdrant+OpenAI, in-memory+Ollama, or disabled.

**Tech Stack:** TypeScript, Vitest, yahoo-finance2, Finnhub API, Qdrant, OpenAI embeddings, Ollama

---

### Task 1: Add ComputedIndicators type and DATA_CRITICALITY

**Files:**
- Modify: `src/agents/base/types.ts`
- Test: `npx tsc --noEmit`

- [ ] **Step 1: Add ComputedIndicators type and DATA_CRITICALITY to types.ts**

Add after the existing `DataType` definition:

```typescript
// After: export type DataType = 'ohlcv' | 'news' | 'fundamentals' | 'technicals'

export const DATA_CRITICALITY: Record<DataType, 'critical' | 'optional'> = {
  ohlcv: 'critical',
  fundamentals: 'critical',
  technicals: 'critical',
  news: 'optional',
}

export type ComputedIndicators = {
  trend: {
    sma50: number
    sma200: number
    ema12: number
    ema26: number
    macd: { line: number; signal: number; histogram: number }
  }
  momentum: {
    rsi: number
    stochastic: { k: number; d: number }
  }
  volatility: {
    bollingerUpper: number
    bollingerMiddle: number
    bollingerLower: number
    atr: number
    historicalVolatility: number
  }
  volume: {
    obv: number
  }
  risk: {
    beta: number
    maxDrawdown: number
    var95: number
  }
  fundamentals: {
    pe: number | null
    pb: number | null
    dividendYield: number | null
    eps: number | null
  }
}
```

- [ ] **Step 2: Add computedIndicators to TradingReport**

Update the `TradingReport` type:

```typescript
export type TradingReport = {
  ticker: string
  market: Market
  timestamp: Date
  rawData: DataResult[]
  computedIndicators?: ComputedIndicators  // ← add this line
  researchFindings: Finding[]
  riskAssessment?: RiskAssessment
  finalDecision?: Decision
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/agents/base/types.ts
git commit -m "feat: add ComputedIndicators type and DATA_CRITICALITY map"
```

---

### Task 2: Create FallbackDataSource

**Files:**
- Create: `src/data/FallbackDataSource.ts`
- Create: `tests/data/fallbackDataSource.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/data/fallbackDataSource.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { FallbackDataSource } from '../../src/data/FallbackDataSource.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataQuery, DataResult } from '../../src/agents/base/types.js'

function makeSource(name: string, fn: (q: DataQuery) => Promise<DataResult>): IDataSource {
  return { name, fetch: fn }
}

const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'ohlcv' }

describe('FallbackDataSource', () => {
  it('returns result from first source when it succeeds', async () => {
    const result: DataResult = { ticker: 'AAPL', market: 'US', type: 'ohlcv', data: { price: 100 }, fetchedAt: new Date() }
    const s1 = makeSource('s1', async () => result)
    const s2 = makeSource('s2', async () => { throw new Error('should not be called') })

    const fallback = new FallbackDataSource('test-chain', [s1, s2])
    expect(await fallback.fetch(query)).toEqual(result)
  })

  it('falls back to second source when first throws', async () => {
    const result: DataResult = { ticker: 'AAPL', market: 'US', type: 'ohlcv', data: { price: 200 }, fetchedAt: new Date() }
    const s1 = makeSource('s1', async () => { throw new Error('403 Forbidden') })
    const s2 = makeSource('s2', async () => result)

    const fallback = new FallbackDataSource('test-chain', [s1, s2])
    expect(await fallback.fetch(query)).toEqual(result)
  })

  it('throws with all errors when every source fails', async () => {
    const s1 = makeSource('s1', async () => { throw new Error('403 Forbidden') })
    const s2 = makeSource('s2', async () => { throw new Error('429 Too Many Requests') })

    const fallback = new FallbackDataSource('test-chain', [s1, s2])
    await expect(fallback.fetch(query)).rejects.toThrow('All sources failed for ohlcv')
  })

  it('includes per-source error details in the thrown error', async () => {
    const s1 = makeSource('s1', async () => { throw new Error('403 Forbidden') })
    const s2 = makeSource('s2', async () => { throw new Error('429 Too Many') })

    const fallback = new FallbackDataSource('test-chain', [s1, s2])
    await expect(fallback.fetch(query)).rejects.toThrow('s1: 403 Forbidden')
    await expect(fallback.fetch(query)).rejects.toThrow('s2: 429 Too Many')
  })

  it('exposes the chain name as .name', () => {
    const fallback = new FallbackDataSource('price-chain', [])
    expect(fallback.name).toBe('price-chain')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/fallbackDataSource.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/data/FallbackDataSource.ts`:

```typescript
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

export class FallbackDataSource implements IDataSource {
  readonly name: string
  private sources: IDataSource[]

  constructor(name: string, sources: IDataSource[]) {
    this.name = name
    this.sources = sources
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const errors: { source: string; error: string }[] = []

    for (const source of this.sources) {
      try {
        const result = await source.fetch(query)
        return result
      } catch (err) {
        const message = (err as Error).message
        console.warn(`[${this.name}] ${source.name}/${query.type} failed: ${message}`)
        errors.push({ source: source.name, error: message })
      }
    }

    const details = errors.map((e) => `${e.source}: ${e.error}`).join(', ')
    throw new Error(`All sources failed for ${query.type} (${query.ticker}): ${details}`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/data/fallbackDataSource.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/FallbackDataSource.ts tests/data/fallbackDataSource.test.ts
git commit -m "feat: add FallbackDataSource — tries sources in order with error aggregation"
```

---

### Task 3: Add criticality enforcement to DataFetcher

**Files:**
- Modify: `src/agents/data/DataFetcher.ts`
- Create: `tests/agents/dataFetcherCriticality.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agents/dataFetcherCriticality.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { DataFetcher } from '../../src/agents/data/DataFetcher.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataQuery, DataResult, TradingReport } from '../../src/agents/base/types.js'

function makeReport(ticker = 'AAPL', market: 'US' | 'CN' | 'HK' = 'US'): TradingReport {
  return { ticker, market, timestamp: new Date(), rawData: [], researchFindings: [] }
}

function makeSource(supportedTypes: string[]): IDataSource {
  return {
    name: 'test-source',
    async fetch(query: DataQuery): Promise<DataResult> {
      if (!supportedTypes.includes(query.type)) {
        throw new Error(`Unsupported: ${query.type}`)
      }
      return { ticker: query.ticker, market: query.market, type: query.type, data: { mock: true }, fetchedAt: new Date() }
    },
  }
}

describe('DataFetcher criticality enforcement', () => {
  it('throws when a critical data type (ohlcv) fails from all sources', async () => {
    // Source supports only news — ohlcv, fundamentals, technicals will fail
    const fetcher = new DataFetcher({ dataSources: [makeSource(['news'])] })
    await expect(fetcher.run(makeReport())).rejects.toThrow('ABORT')
    await expect(fetcher.run(makeReport())).rejects.toThrow('ohlcv')
  })

  it('succeeds when all critical types are fetched, even if optional (news) fails', async () => {
    const fetcher = new DataFetcher({ dataSources: [makeSource(['ohlcv', 'fundamentals', 'technicals'])] })
    const report = await fetcher.run(makeReport())
    expect(report.rawData.length).toBe(3)
  })

  it('succeeds when all four types are fetched', async () => {
    const fetcher = new DataFetcher({ dataSources: [makeSource(['ohlcv', 'fundamentals', 'technicals', 'news'])] })
    const report = await fetcher.run(makeReport())
    expect(report.rawData.length).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/dataFetcherCriticality.test.ts`
Expected: FAIL — first test fails because DataFetcher currently swallows errors

- [ ] **Step 3: Update DataFetcher with criticality enforcement**

In `src/agents/data/DataFetcher.ts`, add the import and update `run()`:

Add import at top:

```typescript
import { DATA_CRITICALITY } from '../base/types.js'
```

Replace the section after `const validResults = ...` (after line 62) and before the RAG section (before `// 2. Chunk + embed + store`) with:

```typescript
    const validResults = results.filter((r): r is DataResult => r !== null)

    // 1b. Enforce data criticality — abort if any critical type has zero results
    const fetchedTypes = new Set(validResults.map((r) => r.type))
    const missingCritical = dataTypes.filter(
      (t) => DATA_CRITICALITY[t] === 'critical' && !fetchedTypes.has(t),
    )
    if (missingCritical.length > 0) {
      throw new Error(
        `ABORT: Failed to fetch critical data types for ${ticker}: ${missingCritical.join(', ')}. ` +
        `Pipeline cannot continue without this data.`,
      )
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agents/dataFetcherCriticality.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Run existing DataFetcher tests to check no regressions**

Run: `npx vitest run tests/agents/dataFetcher.test.ts`
Expected: PASS (existing tests may need adjustment if they relied on swallowed errors)

- [ ] **Step 6: Commit**

```bash
git add src/agents/data/DataFetcher.ts tests/agents/dataFetcherCriticality.test.ts
git commit -m "feat: enforce data criticality — abort pipeline on missing critical data"
```

---

### Task 4: Fix Yahoo Finance data source

**Files:**
- Modify: `src/data/yfinance.ts`
- Modify: `package.json` (if downgrade needed)
- Test: `npx vitest run tests/data/yfinance.test.ts`

- [ ] **Step 1: Check which yahoo-finance2 version is actually installed**

Run: `node -e "import('yahoo-finance2').then(m => { const yf = m.default; const inst = new yf(); let keys = Object.getOwnPropertyNames(inst).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(inst))); console.log([...new Set(keys)].join(', ')) })"`

If output only shows `quote, autoc` (no `historical`, `quoteSummary`, `search`), proceed to Step 2.

- [ ] **Step 2: Downgrade yahoo-finance2 to get full API**

Run: `npm install yahoo-finance2@2.11.3`

Then verify methods exist:
Run: `node -e "import('yahoo-finance2').then(m => { const yf = m.default; const inst = new yf(); let keys = Object.getOwnPropertyNames(Object.getPrototypeOf(inst)); console.log(keys.join(', ')) })"`
Expected: Should include `historical`, `quoteSummary`, `search` among the methods.

If v2.11.3 has the methods, proceed to Step 3. If not, keep the current v2.14 quote()-based approach (it still works as a fallback behind Finnhub).

- [ ] **Step 3: Rewrite yfinance.ts to use the correct API**

If `historical`, `quoteSummary`, and `search` are available after downgrade, rewrite `src/data/yfinance.ts`:

```typescript
// src/data/yfinance.ts
import YahooFinance from 'yahoo-finance2'
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

export class YFinanceSource implements IDataSource {
  readonly name = 'yfinance'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private yf: any

  constructor() {
    this.yf = new (YahooFinance as any)()
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type, from, to } = query
    let data: unknown

    switch (type) {
      case 'ohlcv':
      case 'technicals': {
        const period1 = from ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        const period2 = to ?? new Date()
        data = await this.yf.historical(ticker, {
          period1: period1.toISOString().slice(0, 10),
          period2: period2.toISOString().slice(0, 10),
        })
        break
      }
      case 'fundamentals': {
        const [summary, financials] = await Promise.all([
          this.yf.quoteSummary(ticker, {
            modules: ['financialData', 'defaultKeyStatistics', 'earningsHistory'],
          }),
          this.yf.quoteSummary(ticker, {
            modules: ['incomeStatementHistory', 'balanceSheetHistory'],
          }),
        ])
        data = { summary, financials }
        break
      }
      case 'news': {
        const result = await this.yf.search(ticker)
        data = result.news ?? []
        break
      }
      default:
        throw new Error(`YFinanceSource does not support data type: ${type}`)
    }

    return { ticker, market, type, data, fetchedAt: new Date() }
  }
}
```

If downgrade did NOT add the methods, keep the current quote()-based implementation (it works, just returns less data) and skip to Step 5.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/data/yfinance.ts package.json package-lock.json
git commit -m "fix: restore yahoo-finance2 full API as fallback data source"
```

---

### Task 5: Indicator functions — trend (SMA, EMA, MACD)

**Files:**
- Create: `src/indicators/trend.ts`
- Create: `tests/indicators/trend.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/indicators/trend.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calcSMA, calcEMA, calcMACD } from '../../src/indicators/trend.js'

describe('calcSMA', () => {
  it('calculates simple moving average for given period', () => {
    const prices = [10, 11, 12, 13, 14]
    // SMA(3) of last 3 values: (12+13+14)/3 = 13
    expect(calcSMA(prices, 3)).toBeCloseTo(13, 5)
  })

  it('returns NaN when prices array is shorter than period', () => {
    expect(calcSMA([10, 11], 5)).toBeNaN()
  })
})

describe('calcEMA', () => {
  it('calculates exponential moving average', () => {
    // EMA with period 3, multiplier = 2/(3+1) = 0.5
    // Starting SMA(3) of first 3: (10+11+12)/3 = 11
    // EMA[3] = 13*0.5 + 11*0.5 = 12
    // EMA[4] = 14*0.5 + 12*0.5 = 13
    const prices = [10, 11, 12, 13, 14]
    expect(calcEMA(prices, 3)).toBeCloseTo(13, 5)
  })

  it('returns NaN when prices array is shorter than period', () => {
    expect(calcEMA([10], 5)).toBeNaN()
  })
})

describe('calcMACD', () => {
  it('returns line, signal, and histogram', () => {
    // Need at least 26 data points for default MACD (12,26,9)
    const prices = Array.from({ length: 50 }, (_, i) => 100 + i * 0.5 + Math.sin(i) * 2)
    const result = calcMACD(prices)
    expect(result).toHaveProperty('line')
    expect(result).toHaveProperty('signal')
    expect(result).toHaveProperty('histogram')
    expect(typeof result.line).toBe('number')
    expect(typeof result.signal).toBe('number')
    // histogram = line - signal
    expect(result.histogram).toBeCloseTo(result.line - result.signal, 10)
  })

  it('returns NaN values when prices array is too short', () => {
    const result = calcMACD([10, 11, 12])
    expect(result.line).toBeNaN()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/indicators/trend.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/indicators/trend.ts`:

```typescript
/**
 * Trend indicators: SMA, EMA, MACD
 * All functions are pure — no side effects, no dependencies.
 */

/** Simple Moving Average of the last `period` values */
export function calcSMA(prices: number[], period: number): number {
  if (prices.length < period) return NaN
  const slice = prices.slice(-period)
  return slice.reduce((sum, p) => sum + p, 0) / period
}

/**
 * Exponential Moving Average.
 * Starts with SMA of the first `period` values, then applies EMA formula.
 * Returns the final EMA value.
 */
export function calcEMA(prices: number[], period: number): number {
  if (prices.length < period) return NaN
  const multiplier = 2 / (period + 1)

  // Seed with SMA of first `period` values
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period

  // Apply EMA formula for remaining values
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * multiplier + ema * (1 - multiplier)
  }
  return ema
}

/**
 * MACD (Moving Average Convergence Divergence).
 * Default periods: fast=12, slow=26, signal=9.
 * Returns { line, signal, histogram }.
 */
export function calcMACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { line: number; signal: number; histogram: number } {
  if (prices.length < slowPeriod) {
    return { line: NaN, signal: NaN, histogram: NaN }
  }

  // Build full EMA series for fast and slow
  const fastMultiplier = 2 / (fastPeriod + 1)
  const slowMultiplier = 2 / (slowPeriod + 1)

  let fastEMA = prices.slice(0, fastPeriod).reduce((s, p) => s + p, 0) / fastPeriod
  let slowEMA = prices.slice(0, slowPeriod).reduce((s, p) => s + p, 0) / slowPeriod

  // Advance fast EMA to slowPeriod start
  for (let i = fastPeriod; i < slowPeriod; i++) {
    fastEMA = prices[i] * fastMultiplier + fastEMA * (1 - fastMultiplier)
  }

  // Build MACD line series from slowPeriod onward
  const macdSeries: number[] = []
  for (let i = slowPeriod; i < prices.length; i++) {
    fastEMA = prices[i] * fastMultiplier + fastEMA * (1 - fastMultiplier)
    slowEMA = prices[i] * slowMultiplier + slowEMA * (1 - slowMultiplier)
    macdSeries.push(fastEMA - slowEMA)
  }

  if (macdSeries.length < signalPeriod) {
    return { line: macdSeries[macdSeries.length - 1] ?? NaN, signal: NaN, histogram: NaN }
  }

  // Signal line = EMA of MACD series
  const sigMultiplier = 2 / (signalPeriod + 1)
  let signal = macdSeries.slice(0, signalPeriod).reduce((s, v) => s + v, 0) / signalPeriod
  for (let i = signalPeriod; i < macdSeries.length; i++) {
    signal = macdSeries[i] * sigMultiplier + signal * (1 - sigMultiplier)
  }

  const line = macdSeries[macdSeries.length - 1]
  return { line, signal, histogram: line - signal }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/indicators/trend.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/indicators/trend.ts tests/indicators/trend.test.ts
git commit -m "feat: add trend indicators — SMA, EMA, MACD"
```

---

### Task 6: Indicator functions — momentum (RSI, Stochastic)

**Files:**
- Create: `src/indicators/momentum.ts`
- Create: `tests/indicators/momentum.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/indicators/momentum.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calcRSI, calcStochastic } from '../../src/indicators/momentum.js'

describe('calcRSI', () => {
  it('returns 50 for flat prices (no gains or losses)', () => {
    const prices = Array.from({ length: 20 }, () => 100)
    // No gains, no losses → RSI is conventionally 50
    expect(calcRSI(prices, 14)).toBeCloseTo(50, 0)
  })

  it('returns value near 100 for steadily rising prices', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i)
    const rsi = calcRSI(prices, 14)
    expect(rsi).toBeGreaterThan(95)
  })

  it('returns value near 0 for steadily falling prices', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 200 - i)
    const rsi = calcRSI(prices, 14)
    expect(rsi).toBeLessThan(5)
  })

  it('returns NaN when prices array is too short', () => {
    expect(calcRSI([10, 11], 14)).toBeNaN()
  })
})

describe('calcStochastic', () => {
  it('returns %K and %D values between 0 and 100', () => {
    const highs = Array.from({ length: 20 }, (_, i) => 110 + i)
    const lows = Array.from({ length: 20 }, (_, i) => 90 + i)
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i)
    const result = calcStochastic(highs, lows, closes, 14)
    expect(result.k).toBeGreaterThanOrEqual(0)
    expect(result.k).toBeLessThanOrEqual(100)
    expect(result.d).toBeGreaterThanOrEqual(0)
    expect(result.d).toBeLessThanOrEqual(100)
  })

  it('returns NaN when arrays are too short', () => {
    const result = calcStochastic([10], [5], [7], 14)
    expect(result.k).toBeNaN()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/indicators/momentum.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/indicators/momentum.ts`:

```typescript
/**
 * Momentum indicators: RSI, Stochastic Oscillator
 */

/**
 * Relative Strength Index.
 * Uses Wilder's smoothing method (exponential moving average of gains/losses).
 */
export function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return NaN

  const changes = prices.slice(1).map((p, i) => p - prices[i])

  // Initial average gain/loss from first `period` changes
  let avgGain = 0
  let avgLoss = 0
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]
    else avgLoss += Math.abs(changes[i])
  }
  avgGain /= period
  avgLoss /= period

  // Wilder's smoothing for remaining changes
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

/**
 * Stochastic Oscillator (%K and %D).
 * %K = (close - lowest low) / (highest high - lowest low) * 100
 * %D = 3-period SMA of %K
 */
export function calcStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
  smoothK = 3,
): { k: number; d: number } {
  const len = Math.min(highs.length, lows.length, closes.length)
  if (len < period) return { k: NaN, d: NaN }

  // Build %K series for the last (smoothK) values to compute %D
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/indicators/momentum.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/indicators/momentum.ts tests/indicators/momentum.test.ts
git commit -m "feat: add momentum indicators — RSI, Stochastic"
```

---

### Task 7: Indicator functions — volatility (Bollinger, ATR, historical vol)

**Files:**
- Create: `src/indicators/volatility.ts`
- Create: `tests/indicators/volatility.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/indicators/volatility.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calcBollinger, calcATR, calcHistoricalVolatility } from '../../src/indicators/volatility.js'

describe('calcBollinger', () => {
  it('returns upper, middle (SMA), and lower bands', () => {
    // 25 identical values → stddev = 0, all bands = price
    const prices = Array.from({ length: 25 }, () => 100)
    const result = calcBollinger(prices, 20, 2)
    expect(result.middle).toBeCloseTo(100, 5)
    expect(result.upper).toBeCloseTo(100, 5)
    expect(result.lower).toBeCloseTo(100, 5)
  })

  it('upper > middle > lower for varying prices', () => {
    const prices = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 5)
    const result = calcBollinger(prices, 20, 2)
    expect(result.upper).toBeGreaterThan(result.middle)
    expect(result.middle).toBeGreaterThan(result.lower)
  })

  it('returns NaN when prices are too short', () => {
    const result = calcBollinger([10, 11], 20, 2)
    expect(result.middle).toBeNaN()
  })
})

describe('calcATR', () => {
  it('returns positive ATR for varying prices', () => {
    const highs = Array.from({ length: 20 }, (_, i) => 105 + Math.sin(i) * 3)
    const lows = Array.from({ length: 20 }, (_, i) => 95 + Math.sin(i) * 3)
    const closes = Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i) * 3)
    expect(calcATR(highs, lows, closes, 14)).toBeGreaterThan(0)
  })

  it('returns NaN when arrays too short', () => {
    expect(calcATR([10], [5], [7], 14)).toBeNaN()
  })
})

describe('calcHistoricalVolatility', () => {
  it('returns 0 for flat prices', () => {
    const prices = Array.from({ length: 30 }, () => 100)
    expect(calcHistoricalVolatility(prices)).toBeCloseTo(0, 5)
  })

  it('returns positive value for varying prices', () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10)
    expect(calcHistoricalVolatility(prices)).toBeGreaterThan(0)
  })

  it('returns NaN for insufficient data', () => {
    expect(calcHistoricalVolatility([100])).toBeNaN()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/indicators/volatility.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/indicators/volatility.ts`:

```typescript
/**
 * Volatility indicators: Bollinger Bands, ATR, Historical Volatility
 */

/**
 * Bollinger Bands: middle = SMA(period), upper/lower = middle +/- (stddev * numStdDev).
 */
export function calcBollinger(
  prices: number[],
  period = 20,
  numStdDev = 2,
): { upper: number; middle: number; lower: number } {
  if (prices.length < period) return { upper: NaN, middle: NaN, lower: NaN }

  const slice = prices.slice(-period)
  const middle = slice.reduce((s, p) => s + p, 0) / period
  const variance = slice.reduce((s, p) => s + (p - middle) ** 2, 0) / period
  const stddev = Math.sqrt(variance)

  return {
    upper: middle + numStdDev * stddev,
    middle,
    lower: middle - numStdDev * stddev,
  }
}

/**
 * Average True Range (ATR).
 * True Range = max(high-low, |high-prevClose|, |low-prevClose|).
 * ATR = Wilder's smoothed average of TR.
 */
export function calcATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number {
  const len = Math.min(highs.length, lows.length, closes.length)
  if (len < period + 1) return NaN

  // Calculate True Range series (starts at index 1)
  const trValues: number[] = []
  for (let i = 1; i < len; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    )
    trValues.push(tr)
  }

  // Initial ATR = simple average of first `period` TR values
  let atr = trValues.slice(0, period).reduce((s, v) => s + v, 0) / period

  // Wilder's smoothing
  for (let i = period; i < trValues.length; i++) {
    atr = (atr * (period - 1) + trValues[i]) / period
  }

  return atr
}

/**
 * Annualized historical volatility from log returns.
 * Assumes 252 trading days per year.
 */
export function calcHistoricalVolatility(prices: number[], tradingDays = 252): number {
  if (prices.length < 2) return NaN

  // Log returns
  const returns: number[] = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] <= 0 || prices[i] <= 0) continue
    returns.push(Math.log(prices[i] / prices[i - 1]))
  }

  if (returns.length < 2) return NaN

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
  const dailyVol = Math.sqrt(variance)

  return dailyVol * Math.sqrt(tradingDays)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/indicators/volatility.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/indicators/volatility.ts tests/indicators/volatility.test.ts
git commit -m "feat: add volatility indicators — Bollinger Bands, ATR, historical vol"
```

---

### Task 8: Indicator functions — volume (OBV)

**Files:**
- Create: `src/indicators/volume.ts`
- Create: `tests/indicators/volume.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/indicators/volume.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calcOBV } from '../../src/indicators/volume.js'

describe('calcOBV', () => {
  it('accumulates volume on up days and subtracts on down days', () => {
    const closes = [100, 102, 101, 103, 104]
    const volumes = [1000, 1500, 1200, 1800, 2000]
    // Day 1: up → +1500
    // Day 2: down → +1500 - 1200 = 300
    // Day 3: up → 300 + 1800 = 2100
    // Day 4: up → 2100 + 2000 = 4100
    expect(calcOBV(closes, volumes)).toBe(4100)
  })

  it('returns 0 for flat prices', () => {
    const closes = [100, 100, 100]
    const volumes = [1000, 1500, 1200]
    expect(calcOBV(closes, volumes)).toBe(0)
  })

  it('returns NaN for insufficient data', () => {
    expect(calcOBV([100], [1000])).toBeNaN()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/indicators/volume.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/indicators/volume.ts`:

```typescript
/**
 * Volume indicators: On-Balance Volume (OBV)
 */

/**
 * On-Balance Volume.
 * Adds volume on up-close days, subtracts on down-close days, ignores flat days.
 */
export function calcOBV(closes: number[], volumes: number[]): number {
  const len = Math.min(closes.length, volumes.length)
  if (len < 2) return NaN

  let obv = 0
  for (let i = 1; i < len; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i]
    else if (closes[i] < closes[i - 1]) obv -= volumes[i]
    // flat day: obv unchanged
  }
  return obv
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/indicators/volume.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/indicators/volume.ts tests/indicators/volume.test.ts
git commit -m "feat: add volume indicator — OBV"
```

---

### Task 9: Indicator functions — risk (beta, max drawdown, VaR)

**Files:**
- Create: `src/indicators/risk.ts`
- Create: `tests/indicators/risk.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/indicators/risk.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calcBeta, calcMaxDrawdown, calcVaR } from '../../src/indicators/risk.js'

describe('calcBeta', () => {
  it('returns 1.0 when stock returns match market returns', () => {
    const returns = [0.01, -0.02, 0.03, -0.01, 0.02, 0.01, -0.03, 0.02, 0.01, -0.01]
    expect(calcBeta(returns, returns)).toBeCloseTo(1.0, 5)
  })

  it('returns 2.0 when stock moves at 2x market', () => {
    const market = [0.01, -0.02, 0.03, -0.01, 0.02, 0.01, -0.03, 0.02, 0.01, -0.01]
    const stock = market.map((r) => r * 2)
    expect(calcBeta(stock, market)).toBeCloseTo(2.0, 5)
  })

  it('returns NaN when arrays are empty', () => {
    expect(calcBeta([], [])).toBeNaN()
  })
})

describe('calcMaxDrawdown', () => {
  it('calculates max peak-to-trough decline as a positive decimal', () => {
    // Peak at 200, trough at 150 → drawdown = (200-150)/200 = 0.25
    const prices = [100, 150, 200, 180, 150, 170, 190]
    expect(calcMaxDrawdown(prices)).toBeCloseTo(0.25, 5)
  })

  it('returns 0 for monotonically increasing prices', () => {
    const prices = [100, 110, 120, 130]
    expect(calcMaxDrawdown(prices)).toBeCloseTo(0, 5)
  })

  it('returns NaN for single price', () => {
    expect(calcMaxDrawdown([100])).toBeNaN()
  })
})

describe('calcVaR', () => {
  it('returns a positive number for the 95th percentile loss', () => {
    // Generate some returns with a known distribution
    const returns = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000)
    const var95 = calcVaR(returns, 0.95)
    expect(var95).toBeGreaterThan(0)
  })

  it('higher confidence → larger VaR', () => {
    const returns = Array.from({ length: 200 }, (_, i) => (i - 100) / 1000)
    const var90 = calcVaR(returns, 0.90)
    const var99 = calcVaR(returns, 0.99)
    expect(var99).toBeGreaterThan(var90)
  })

  it('returns NaN for empty array', () => {
    expect(calcVaR([], 0.95)).toBeNaN()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/indicators/risk.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/indicators/risk.ts`:

```typescript
/**
 * Risk indicators: Beta, Max Drawdown, Value at Risk (VaR)
 */

/**
 * Beta = Cov(stock, market) / Var(market).
 * Takes arrays of daily returns (not prices).
 */
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

/**
 * Maximum drawdown: largest peak-to-trough decline as a positive decimal.
 * e.g., 0.25 means the price dropped 25% from a peak.
 */
export function calcMaxDrawdown(prices: number[]): number {
  if (prices.length < 2) return NaN

  let peak = prices[0]
  let maxDD = 0

  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > peak) {
      peak = prices[i]
    } else {
      const dd = (peak - prices[i]) / peak
      if (dd > maxDD) maxDD = dd
    }
  }

  return maxDD
}

/**
 * Historical Value at Risk (VaR) using percentile method.
 * Returns the loss (as positive number) at the given confidence level.
 * e.g., confidence=0.95 → 5th percentile of returns, negated.
 */
export function calcVaR(returns: number[], confidence = 0.95): number {
  if (returns.length === 0) return NaN

  const sorted = [...returns].sort((a, b) => a - b)
  const index = Math.floor((1 - confidence) * sorted.length)
  const varValue = sorted[Math.max(0, index)]

  // Return as positive number (it's a loss)
  return -varValue
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/indicators/risk.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/indicators/risk.ts tests/indicators/risk.test.ts
git commit -m "feat: add risk indicators — beta, max drawdown, VaR"
```

---

### Task 10: Indicator index re-export

**Files:**
- Create: `src/indicators/index.ts`

- [ ] **Step 1: Create the re-export barrel file**

Create `src/indicators/index.ts`:

```typescript
export { calcSMA, calcEMA, calcMACD } from './trend.js'
export { calcRSI, calcStochastic } from './momentum.js'
export { calcBollinger, calcATR, calcHistoricalVolatility } from './volatility.js'
export { calcOBV } from './volume.js'
export { calcBeta, calcMaxDrawdown, calcVaR } from './risk.js'
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all indicator tests**

Run: `npx vitest run tests/indicators/`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/indicators/index.ts
git commit -m "feat: add indicators barrel export"
```

---

### Task 11: TechnicalAnalyzer agent

**Files:**
- Create: `src/agents/analyzer/TechnicalAnalyzer.ts`
- Create: `tests/agents/technicalAnalyzer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agents/technicalAnalyzer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { TechnicalAnalyzer } from '../../src/agents/analyzer/TechnicalAnalyzer.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataResult, TradingReport } from '../../src/agents/base/types.js'

// Generate realistic OHLCV data for testing
function makeOHLCV(days: number) {
  const data: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = []
  let price = 150
  for (let i = 0; i < days; i++) {
    const change = (Math.random() - 0.48) * 3
    const open = price
    const close = price + change
    const high = Math.max(open, close) + Math.random() * 2
    const low = Math.min(open, close) - Math.random() * 2
    data.push({
      date: new Date(Date.now() - (days - i) * 86400000).toISOString().slice(0, 10),
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: Math.floor(50_000_000 + Math.random() * 20_000_000),
    })
    price = close
  }
  return data
}

function makeReport(ohlcvData: unknown): TradingReport {
  const ohlcvResult: DataResult = {
    ticker: 'AAPL', market: 'US', type: 'ohlcv', data: ohlcvData, fetchedAt: new Date(),
  }
  const fundResult: DataResult = {
    ticker: 'AAPL', market: 'US', type: 'fundamentals',
    data: { summary: { financialData: { currentPrice: 150 }, defaultKeyStatistics: { trailingPE: 30, priceToBook: 45, trailingEps: 6.5 } } },
    fetchedAt: new Date(),
  }
  return {
    ticker: 'AAPL', market: 'US', timestamp: new Date(),
    rawData: [ohlcvResult, fundResult], researchFindings: [],
  }
}

// Stub data source for SPY (market benchmark)
const spySource: IDataSource = {
  name: 'spy-stub',
  async fetch() {
    return {
      ticker: 'SPY', market: 'US', type: 'ohlcv',
      data: makeOHLCV(250),
      fetchedAt: new Date(),
    }
  },
}

describe('TechnicalAnalyzer', () => {
  it('populates computedIndicators on the report', async () => {
    const analyzer = new TechnicalAnalyzer({ dataSource: spySource })
    const report = await analyzer.run(makeReport(makeOHLCV(250)))

    expect(report.computedIndicators).toBeDefined()
    const ci = report.computedIndicators!

    // Trend
    expect(typeof ci.trend.sma50).toBe('number')
    expect(typeof ci.trend.sma200).toBe('number')
    expect(typeof ci.trend.macd.line).toBe('number')

    // Momentum
    expect(ci.momentum.rsi).toBeGreaterThanOrEqual(0)
    expect(ci.momentum.rsi).toBeLessThanOrEqual(100)

    // Volatility
    expect(ci.volatility.bollingerUpper).toBeGreaterThan(ci.volatility.bollingerLower)
    expect(ci.volatility.atr).toBeGreaterThan(0)
    expect(ci.volatility.historicalVolatility).toBeGreaterThan(0)

    // Volume
    expect(typeof ci.volume.obv).toBe('number')

    // Risk
    expect(typeof ci.risk.beta).toBe('number')
    expect(ci.risk.maxDrawdown).toBeGreaterThanOrEqual(0)
    expect(ci.risk.var95).toBeGreaterThan(0)
  })

  it('throws when OHLCV data is missing', async () => {
    const analyzer = new TechnicalAnalyzer({ dataSource: spySource })
    const report: TradingReport = {
      ticker: 'AAPL', market: 'US', timestamp: new Date(),
      rawData: [], researchFindings: [],
    }
    await expect(analyzer.run(report)).rejects.toThrow('missing OHLCV')
  })

  it('extracts fundamentals from rawData when available', async () => {
    const analyzer = new TechnicalAnalyzer({ dataSource: spySource })
    const report = await analyzer.run(makeReport(makeOHLCV(250)))
    expect(report.computedIndicators!.fundamentals.pe).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agents/technicalAnalyzer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/agents/analyzer/TechnicalAnalyzer.ts`:

```typescript
import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, TradingReport, ComputedIndicators } from '../base/types.js'
import type { IDataSource } from '../../data/IDataSource.js'
import {
  calcSMA, calcEMA, calcMACD,
  calcRSI, calcStochastic,
  calcBollinger, calcATR, calcHistoricalVolatility,
  calcOBV,
  calcBeta, calcMaxDrawdown, calcVaR,
} from '../../indicators/index.js'

type OHLCVBar = {
  date?: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type TechnicalAnalyzerConfig = {
  dataSource: IDataSource  // used to fetch SPY for beta calculation
}

export class TechnicalAnalyzer implements IAgent {
  readonly name = 'technicalAnalyzer'
  readonly role: AgentRole = 'data'

  private dataSource: IDataSource

  constructor(config: TechnicalAnalyzerConfig) {
    this.dataSource = config.dataSource
  }

  async run(report: TradingReport): Promise<TradingReport> {
    // Extract OHLCV bars from rawData
    const ohlcvResult = report.rawData.find((r) => r.type === 'ohlcv')
    if (!ohlcvResult) {
      throw new Error(`TechnicalAnalyzer: missing OHLCV data for ${report.ticker}`)
    }

    const bars = this.parseBars(ohlcvResult.data)
    if (bars.length < 30) {
      throw new Error(`TechnicalAnalyzer: insufficient OHLCV data (${bars.length} bars, need >= 30)`)
    }

    const closes = bars.map((b) => b.close)
    const highs = bars.map((b) => b.high)
    const lows = bars.map((b) => b.low)
    const volumes = bars.map((b) => b.volume)

    // Compute stock returns for beta/VaR
    const stockReturns = this.calcReturns(closes)

    // Fetch SPY for beta calculation
    let marketReturns: number[] = []
    try {
      const spyResult = await this.dataSource.fetch({
        ticker: 'SPY',
        market: report.market,
        type: 'ohlcv',
        from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      })
      const spyBars = this.parseBars(spyResult.data)
      const spyCloses = spyBars.map((b) => b.close)
      marketReturns = this.calcReturns(spyCloses)
    } catch {
      console.warn('[TechnicalAnalyzer] Could not fetch SPY for beta — using beta=1')
    }

    // Extract fundamentals from rawData
    const fundResult = report.rawData.find((r) => r.type === 'fundamentals')
    const fundamentals = this.extractFundamentals(fundResult?.data)

    const macd = calcMACD(closes)
    const bollinger = calcBollinger(closes, 20, 2)

    const computedIndicators: ComputedIndicators = {
      trend: {
        sma50: calcSMA(closes, 50),
        sma200: calcSMA(closes, 200),
        ema12: calcEMA(closes, 12),
        ema26: calcEMA(closes, 26),
        macd,
      },
      momentum: {
        rsi: calcRSI(closes, 14),
        stochastic: calcStochastic(highs, lows, closes, 14),
      },
      volatility: {
        bollingerUpper: bollinger.upper,
        bollingerMiddle: bollinger.middle,
        bollingerLower: bollinger.lower,
        atr: calcATR(highs, lows, closes, 14),
        historicalVolatility: calcHistoricalVolatility(closes),
      },
      volume: {
        obv: calcOBV(closes, volumes),
      },
      risk: {
        beta: marketReturns.length >= 2
          ? calcBeta(stockReturns.slice(-marketReturns.length), marketReturns)
          : 1,
        maxDrawdown: calcMaxDrawdown(closes),
        var95: calcVaR(stockReturns, 0.95),
      },
      fundamentals,
    }

    return { ...report, computedIndicators }
  }

  private parseBars(data: unknown): OHLCVBar[] {
    if (!Array.isArray(data)) {
      // Finnhub candle format: { c: [], h: [], l: [], o: [], v: [], t: [], s: 'ok' }
      const d = data as Record<string, unknown>
      if (d.s === 'ok' && Array.isArray(d.c)) {
        const c = d.c as number[]
        const h = d.h as number[]
        const l = d.l as number[]
        const o = d.o as number[]
        const v = d.v as number[]
        return c.map((_, i) => ({
          open: o[i], high: h[i], low: l[i], close: c[i], volume: v[i],
        }))
      }
      // Single quote object (yahoo-finance2 v2.14 fallback)
      if (d.price != null) {
        return [{
          open: d.open as number ?? d.price as number,
          high: d.high as number ?? d.price as number,
          low: d.low as number ?? d.price as number,
          close: d.price as number,
          volume: d.volume as number ?? 0,
        }]
      }
      throw new Error('TechnicalAnalyzer: unrecognized OHLCV data format')
    }
    // Array of bar objects (yahoo-finance2 historical format)
    return data.map((bar: Record<string, unknown>) => ({
      open: (bar.open ?? bar.Open) as number,
      high: (bar.high ?? bar.High) as number,
      low: (bar.low ?? bar.Low) as number,
      close: (bar.close ?? bar.Close ?? bar.adjClose) as number,
      volume: (bar.volume ?? bar.Volume) as number,
    }))
  }

  private calcReturns(prices: number[]): number[] {
    const returns: number[] = []
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1] > 0) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1])
      }
    }
    return returns
  }

  private extractFundamentals(data: unknown): ComputedIndicators['fundamentals'] {
    const defaults = { pe: null, pb: null, dividendYield: null, eps: null }
    if (!data || typeof data !== 'object') return defaults

    const d = data as Record<string, unknown>

    // yahoo-finance2 quoteSummary format
    const summary = d.summary as Record<string, unknown> | undefined
    const financialData = (summary?.financialData ?? d.financialData) as Record<string, unknown> | undefined
    const keyStats = (summary?.defaultKeyStatistics ?? d.defaultKeyStatistics) as Record<string, unknown> | undefined

    // Finnhub metrics format
    const metrics = (d.metrics as Record<string, unknown>)?.metric as Record<string, unknown> | undefined

    return {
      pe: (keyStats?.trailingPE ?? metrics?.peBasicExclExtraTTM ?? d.trailingPE ?? null) as number | null,
      pb: (keyStats?.priceToBook ?? metrics?.pbAnnual ?? d.priceToBook ?? null) as number | null,
      dividendYield: (keyStats?.dividendYield ?? metrics?.dividendYieldIndicatedAnnual ?? d.dividendYield ?? null) as number | null,
      eps: (keyStats?.trailingEps ?? metrics?.epsBasicExclExtraItemsTTM ?? d.trailingEps ?? null) as number | null,
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/agents/technicalAnalyzer.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/analyzer/TechnicalAnalyzer.ts tests/agents/technicalAnalyzer.test.ts
git commit -m "feat: add TechnicalAnalyzer — computes indicators from raw OHLCV data"
```

---

### Task 12: InMemoryVectorStore

**Files:**
- Create: `src/rag/InMemoryVectorStore.ts`
- Create: `tests/rag/inMemoryVectorStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/rag/inMemoryVectorStore.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { InMemoryVectorStore } from '../../src/rag/InMemoryVectorStore.js'

describe('InMemoryVectorStore', () => {
  it('stores and retrieves documents by vector similarity', async () => {
    const store = new InMemoryVectorStore()
    await store.upsert([
      { id: '1', content: 'bullish signal', embedding: [1, 0, 0], metadata: { ticker: 'AAPL' } },
      { id: '2', content: 'bearish signal', embedding: [0, 1, 0], metadata: { ticker: 'AAPL' } },
      { id: '3', content: 'neutral signal', embedding: [0, 0, 1], metadata: { ticker: 'GOOG' } },
    ])

    // Query close to [1,0,0] → should return '1' first
    const results = await store.search([0.9, 0.1, 0], 2)
    expect(results.length).toBe(2)
    expect(results[0].id).toBe('1')
  })

  it('filters by metadata', async () => {
    const store = new InMemoryVectorStore()
    await store.upsert([
      { id: '1', content: 'AAPL data', embedding: [1, 0], metadata: { ticker: 'AAPL' } },
      { id: '2', content: 'GOOG data', embedding: [0.9, 0.1], metadata: { ticker: 'GOOG' } },
    ])

    const results = await store.search([1, 0], 5, { must: [{ ticker: 'GOOG' }] })
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('2')
  })

  it('deletes documents by id', async () => {
    const store = new InMemoryVectorStore()
    await store.upsert([
      { id: '1', content: 'test', embedding: [1, 0], metadata: {} },
    ])
    await store.delete(['1'])
    const results = await store.search([1, 0], 5)
    expect(results.length).toBe(0)
  })

  it('upserts (overwrites) existing documents', async () => {
    const store = new InMemoryVectorStore()
    await store.upsert([{ id: '1', content: 'old', embedding: [1, 0], metadata: {} }])
    await store.upsert([{ id: '1', content: 'new', embedding: [0, 1], metadata: {} }])
    const results = await store.search([0, 1], 1)
    expect(results[0].content).toBe('new')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rag/inMemoryVectorStore.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/rag/InMemoryVectorStore.ts`:

```typescript
import type { IVectorStore, Document, MetadataFilter } from './IVectorStore.js'

export class InMemoryVectorStore implements IVectorStore {
  private docs = new Map<string, Document>()

  async upsert(docs: Document[]): Promise<void> {
    for (const doc of docs) {
      this.docs.set(doc.id, doc)
    }
  }

  async search(query: number[], topK: number, filter?: MetadataFilter): Promise<Document[]> {
    let candidates = [...this.docs.values()]

    // Apply metadata filters
    if (filter?.must) {
      for (const condition of filter.must) {
        candidates = candidates.filter((doc) => {
          for (const [key, value] of Object.entries(condition)) {
            if (doc.metadata?.[key] !== value) return false
          }
          return true
        })
      }
    }

    // Score by cosine similarity
    const scored = candidates
      .filter((doc) => doc.embedding != null)
      .map((doc) => ({
        doc,
        score: cosineSimilarity(query, doc.embedding!),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    return scored.map((s) => s.doc)
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.docs.delete(id)
    }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/rag/inMemoryVectorStore.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/rag/InMemoryVectorStore.ts tests/rag/inMemoryVectorStore.test.ts
git commit -m "feat: add InMemoryVectorStore — in-memory IVectorStore with cosine similarity"
```

---

### Task 13: OllamaEmbedder

**Files:**
- Create: `src/rag/OllamaEmbedder.ts`
- Create: `tests/rag/ollamaEmbedder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/rag/ollamaEmbedder.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { OllamaEmbedder } from '../../src/rag/OllamaEmbedder.js'

// Mock the ollama module
vi.mock('ollama', () => ({
  Ollama: class {
    constructor() {}
    async embed(opts: { model: string; input: string | string[] }) {
      const inputs = Array.isArray(opts.input) ? opts.input : [opts.input]
      // Return deterministic fake embeddings based on input length
      return {
        embeddings: inputs.map((text) =>
          Array.from({ length: 4 }, (_, i) => text.length * 0.01 + i * 0.1),
        ),
      }
    }
  },
}))

describe('OllamaEmbedder', () => {
  it('embeds a single text and returns a number array', async () => {
    const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' })
    const result = await embedder.embed('hello world')
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(4)
    expect(typeof result[0]).toBe('number')
  })

  it('embeds a batch of texts', async () => {
    const embedder = new OllamaEmbedder({ model: 'nomic-embed-text' })
    const results = await embedder.embedBatch(['hello', 'world'])
    expect(results.length).toBe(2)
    expect(results[0].length).toBe(4)
    expect(results[1].length).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rag/ollamaEmbedder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/rag/OllamaEmbedder.ts`:

```typescript
import { Ollama } from 'ollama'

type OllamaEmbedderConfig = {
  model: string
  host?: string
}

export class OllamaEmbedder {
  private client: Ollama
  private model: string

  constructor(config: OllamaEmbedderConfig) {
    this.model = config.model
    this.client = new Ollama({ host: config.host ?? process.env['OLLAMA_HOST'] ?? 'http://localhost:11434' })
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embed({ model: this.model, input: text })
    return response.embeddings[0]
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embed({ model: this.model, input: texts })
    return response.embeddings
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/rag/ollamaEmbedder.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/rag/OllamaEmbedder.ts tests/rag/ollamaEmbedder.test.ts
git commit -m "feat: add OllamaEmbedder — local embeddings via Ollama"
```

---

### Task 14: Add requiredData guard to BaseResearcher

**Files:**
- Modify: `src/agents/researcher/BaseResearcher.ts`
- Modify: `src/agents/researcher/BullResearcher.ts`
- Modify: `src/agents/researcher/BearResearcher.ts`
- Modify: `src/agents/researcher/FundamentalsAnalyst.ts`
- Modify: `src/agents/researcher/NewsAnalyst.ts`

- [ ] **Step 1: Add requiredData to BaseResearcher and validation in run()**

In `src/agents/researcher/BaseResearcher.ts`, add the abstract property after `abstract readonly name: string`:

```typescript
  abstract readonly requiredData: DataType[]
```

Add the import for `DataType` (it's already imported via `types.js`). Then add validation at the top of `run()`, before the LLM call:

```typescript
  async run(report: TradingReport): Promise<TradingReport> {
    // Validate required data is present
    const missing = this.requiredData.filter(
      (type) =>
        !report.rawData.some((d) => d.type === type) &&
        !(type === 'technicals' && report.computedIndicators),
    )
    if (missing.length > 0) {
      throw new Error(
        `${this.name}: cannot analyze — missing required data: ${missing.join(', ')}`,
      )
    }

    const context = await this.retrieveContext(report)
    // ... rest unchanged
```

Add `ComputedIndicators` to the import from `types.js`:

```typescript
import type { AgentRole, ComputedIndicators, DataType, Finding, TradingReport } from '../base/types.js'
```

- [ ] **Step 2: Add requiredData to each researcher**

In `src/agents/researcher/BullResearcher.ts`, add after `readonly name = 'bullResearcher'`:

```typescript
  readonly requiredData: DataType[] = ['ohlcv', 'fundamentals']
```

Add import: `import type { DataType } from '../base/types.js'` (or add to existing import if TradingReport is already imported from types).

In `src/agents/researcher/BearResearcher.ts`, add after `readonly name = 'bearResearcher'`:

```typescript
  readonly requiredData: DataType[] = ['ohlcv', 'fundamentals']
```

In `src/agents/researcher/FundamentalsAnalyst.ts`, add after `readonly name = 'fundamentalsAnalyst'`:

```typescript
  readonly requiredData: DataType[] = ['fundamentals']
```

In `src/agents/researcher/NewsAnalyst.ts`, add after `readonly name = 'newsAnalyst'`:

```typescript
  readonly requiredData: DataType[] = []
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/agents/researcher/BaseResearcher.ts src/agents/researcher/BullResearcher.ts src/agents/researcher/BearResearcher.ts src/agents/researcher/FundamentalsAnalyst.ts src/agents/researcher/NewsAnalyst.ts
git commit -m "feat: add requiredData guard — agents throw on missing critical data"
```

---

### Task 15: Restructure agent prompts with computed indicators

**Files:**
- Modify: `src/agents/researcher/BaseResearcher.ts`
- Modify: `src/agents/researcher/BullResearcher.ts`
- Modify: `src/agents/researcher/BearResearcher.ts`
- Modify: `src/agents/researcher/FundamentalsAnalyst.ts`
- Modify: `src/agents/researcher/NewsAnalyst.ts`

- [ ] **Step 1: Add formatIndicators helper to BaseResearcher**

In `src/agents/researcher/BaseResearcher.ts`, add this method after `formatRawData()`:

```typescript
  /** Format computed indicators into a human-readable block for the LLM */
  protected formatIndicators(report: TradingReport): string {
    const ci = report.computedIndicators
    if (!ci) return ''

    const lines: string[] = ['=== COMPUTED INDICATORS (calculated from real market data) ===']

    const fmt = (v: number | null, decimals = 2) =>
      v == null || isNaN(v) ? 'N/A' : v.toFixed(decimals)

    lines.push(`Trend:       SMA50=$${fmt(ci.trend.sma50)}  SMA200=$${fmt(ci.trend.sma200)}  MACD=${fmt(ci.trend.macd.line)} (signal=${fmt(ci.trend.macd.signal)}, hist=${fmt(ci.trend.macd.histogram)})`)
    lines.push(`Momentum:    RSI=${fmt(ci.momentum.rsi, 1)}  Stochastic %K=${fmt(ci.momentum.stochastic.k, 1)} %D=${fmt(ci.momentum.stochastic.d, 1)}`)
    lines.push(`Volatility:  Bollinger [$${fmt(ci.volatility.bollingerLower)} / $${fmt(ci.volatility.bollingerMiddle)} / $${fmt(ci.volatility.bollingerUpper)}]  ATR=$${fmt(ci.volatility.atr)}  HistVol=${fmt(ci.volatility.historicalVolatility * 100, 1)}%`)
    lines.push(`Volume:      OBV=${ci.volume.obv > 0 ? '+' : ''}${(ci.volume.obv / 1e6).toFixed(1)}M`)
    lines.push(`Risk:        Beta=${fmt(ci.risk.beta)}  MaxDrawdown=-${fmt(ci.risk.maxDrawdown * 100, 1)}%  VaR95=-${fmt(ci.risk.var95 * 100, 2)}%`)
    lines.push(`Fundamentals: P/E=${fmt(ci.fundamentals.pe)}  P/B=${fmt(ci.fundamentals.pb)}  DivYield=${ci.fundamentals.dividendYield != null ? fmt(ci.fundamentals.dividendYield * 100, 2) + '%' : 'N/A'}  EPS=$${fmt(ci.fundamentals.eps)}`)

    return lines.join('\n')
  }
```

- [ ] **Step 2: Update buildSystemPrompt signature to receive indicators**

Change the abstract method and the `run()` call in `BaseResearcher.ts`:

```typescript
  async run(report: TradingReport): Promise<TradingReport> {
    // ... (validation from Task 14)

    const context = await this.retrieveContext(report)
    const indicators = this.formatIndicators(report)
    const rawDataContext = this.formatRawData(report)
    const systemPrompt = this.buildSystemPrompt(report, context, rawDataContext, indicators)
    const response = await this.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analyze ${report.ticker} on the ${report.market} market. Base your analysis ONLY on the data provided above. Do not invent numbers. Respond with JSON only.` },
    ])
    // ... rest unchanged
```

Update the abstract signature:

```typescript
  protected abstract buildSystemPrompt(report: TradingReport, context: string, rawDataContext: string, indicators: string): string
```

- [ ] **Step 3: Update BullResearcher prompt**

Rewrite `buildSystemPrompt` in `src/agents/researcher/BullResearcher.ts`:

```typescript
  protected buildSystemPrompt(_report: TradingReport, context: string, rawDataContext: string, indicators: string): string {
    return `You are a bullish equity analyst. Find evidence that supports buying ${_report.ticker}.

${indicators}

${context ? `=== RAG CONTEXT (historical patterns) ===\n${context}\n` : ''}
${rawDataContext ? `=== RAW DATA (for reference) ===\n${rawDataContext}\n` : ''}
RULES:
- ALL evidence MUST cite specific numbers from the indicators or data above
- If a data point is not shown above, say "data not available" — do NOT estimate
- Confidence must reflect data quality: strong data = high confidence, gaps = lower

Respond with ONLY a JSON object:
{
  "stance": "bull",
  "evidence": ["<evidence citing specific numbers>", "..."],
  "confidence": <number 0-1>
}`
  }
```

- [ ] **Step 4: Update BearResearcher prompt**

Rewrite `buildSystemPrompt` in `src/agents/researcher/BearResearcher.ts`:

```typescript
  protected buildSystemPrompt(_report: TradingReport, context: string, rawDataContext: string, indicators: string): string {
    return `You are a bearish equity analyst. Find evidence that supports selling or avoiding ${_report.ticker}.

${indicators}

${context ? `=== RAG CONTEXT (historical patterns) ===\n${context}\n` : ''}
${rawDataContext ? `=== RAW DATA (for reference) ===\n${rawDataContext}\n` : ''}
RULES:
- ALL evidence MUST cite specific numbers from the indicators or data above
- If a data point is not shown above, say "data not available" — do NOT estimate
- Confidence must reflect data quality: strong data = high confidence, gaps = lower

Respond with ONLY a JSON object:
{
  "stance": "bear",
  "evidence": ["<evidence citing specific numbers>", "..."],
  "confidence": <number 0-1>
}`
  }
```

- [ ] **Step 5: Update FundamentalsAnalyst prompt**

Rewrite `buildSystemPrompt` in `src/agents/researcher/FundamentalsAnalyst.ts`:

```typescript
  protected buildSystemPrompt(_report: TradingReport, context: string, rawDataContext: string, indicators: string): string {
    return `You are a fundamental equity analyst. Assess the financial health of ${_report.ticker}.

${indicators}

${context ? `=== RAG CONTEXT (historical patterns) ===\n${context}\n` : ''}
${rawDataContext ? `=== RAW DATA (for reference) ===\n${rawDataContext}\n` : ''}
RULES:
- Extract ALL metrics (PE, EPS, P/B, etc.) from the computed indicators above
- If a metric shows "N/A" above, report it as null — do NOT estimate
- Confidence must reflect data quality

Respond with ONLY a JSON object:
{
  "stance": "bull" | "bear" | "neutral",
  "fundamentalScore": <number 0-100>,
  "keyMetrics": { "PE": <number or null>, "revenueGrowth": <number or null>, "profitMargin": <number or null> },
  "evidence": ["<point citing actual figures>", "..."],
  "confidence": <number 0-1>
}`
  }
```

- [ ] **Step 6: Update NewsAnalyst prompt**

Rewrite `buildSystemPrompt` in `src/agents/researcher/NewsAnalyst.ts`:

```typescript
  protected buildSystemPrompt(_report: TradingReport, context: string, rawDataContext: string, indicators: string): string {
    return `You are a financial news and sentiment analyst for ${_report.ticker}.

${indicators}

${context ? `=== RAG CONTEXT (historical patterns) ===\n${context}\n` : ''}
${rawDataContext ? `=== RAW DATA (for reference) ===\n${rawDataContext}\n` : ''}
RULES:
- Base ALL evidence on the data provided (analyst ratings, target prices, sector info)
- Do not fabricate news headlines or events
- If no news data is available, clearly state that and lower confidence
- Confidence must reflect data quality

Respond with ONLY a JSON object:
{
  "stance": "bull" | "bear" | "neutral",
  "sentiment": "<description derived from available data>",
  "evidence": ["<point citing specific data>", "..."],
  "confidence": <number 0-1>
}`
  }
```

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/agents/researcher/BaseResearcher.ts src/agents/researcher/BullResearcher.ts src/agents/researcher/BearResearcher.ts src/agents/researcher/FundamentalsAnalyst.ts src/agents/researcher/NewsAnalyst.ts
git commit -m "feat: restructure agent prompts — computed indicators + no-fabrication rules"
```

---

### Task 16: Update RiskAnalyst to use computed indicators

**Files:**
- Modify: `src/agents/risk/RiskAnalyst.ts`

- [ ] **Step 1: Rewrite RiskAnalyst to use computedIndicators**

Replace the `run()` and `buildContext()` methods in `src/agents/risk/RiskAnalyst.ts`:

```typescript
  async run(report: TradingReport): Promise<TradingReport> {
    const ci = report.computedIndicators
    if (!ci) {
      throw new Error('RiskAnalyst: missing computedIndicators — TechnicalAnalyzer must run first')
    }

    // Use pre-computed risk metrics directly
    const riskMetrics = {
      VaR: ci.risk.var95,
      volatility: ci.volatility.historicalVolatility,
      beta: ci.risk.beta,
      maxDrawdown: ci.risk.maxDrawdown,
    }

    // Determine risk level from computed metrics
    const context = this.buildContext(report, riskMetrics)
    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are a quantitative risk analyst. The risk metrics below were computed from actual market data — do NOT recalculate them. Your job is to interpret these metrics and determine the overall risk level.
${context}
Respond with ONLY a JSON object:
{
  "riskLevel": "low" | "medium" | "high"
}`,
      },
      { role: 'user', content: `Classify the risk level for ${report.ticker} based on the pre-computed metrics. Respond with JSON only.` },
    ])

    const parsed = this.parseAssessment(response)

    return {
      ...report,
      riskAssessment: {
        riskLevel: parsed.riskLevel ?? 'medium',
        metrics: riskMetrics,
      },
    }
  }

  private buildContext(report: TradingReport, metrics: RiskAssessment['metrics']): string {
    const lines: string[] = [
      `Pre-computed risk metrics for ${report.ticker}:`,
      `  VaR (95%, 1-day): ${(metrics.VaR * 100).toFixed(2)}%`,
      `  Annualized volatility: ${(metrics.volatility * 100).toFixed(1)}%`,
      `  Beta vs market: ${metrics.beta.toFixed(2)}`,
      `  Max drawdown: ${(metrics.maxDrawdown * 100).toFixed(1)}%`,
    ]
    if (report.researchFindings.length > 0) {
      const summary = report.researchFindings
        .map((f) => `${f.agentName}: ${f.stance} (confidence: ${f.confidence.toFixed(2)})`)
        .join(', ')
      lines.push(`Research stances: ${summary}`)
    }
    return lines.join('\n')
  }
```

Add `ComputedIndicators` to the import from `types.js`:

```typescript
import type { AgentRole, RiskAssessment, TradingReport } from '../base/types.js'
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/agents/risk/RiskAnalyst.ts
git commit -m "feat: RiskAnalyst uses pre-computed indicators instead of LLM guesswork"
```

---

### Task 17: Update Manager to refuse on zero findings

**Files:**
- Modify: `src/agents/manager/Manager.ts`

- [ ] **Step 1: Add guard at the top of Manager.run()**

In `src/agents/manager/Manager.ts`, add at the beginning of `run()`:

```typescript
  async run(report: TradingReport): Promise<TradingReport> {
    if (report.researchFindings.length === 0) {
      throw new Error('Manager: cannot make a decision — no research findings available')
    }
    // ... rest unchanged
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/agents/manager/Manager.ts
git commit -m "feat: Manager refuses to decide with zero research findings"
```

---

### Task 18: Update Orchestrator with TechnicalAnalyzer stage

**Files:**
- Modify: `src/orchestrator/Orchestrator.ts`

- [ ] **Step 1: Add TechnicalAnalyzer to orchestrator config and pipeline**

In `src/orchestrator/Orchestrator.ts`, update the config type and constructor:

```typescript
import type { IAgent } from '../agents/base/IAgent.js'
import type { Market, TradingReport } from '../agents/base/types.js'

type OrchestratorConfig = {
  dataFetcher?: IAgent
  technicalAnalyzer?: IAgent  // ← add this
  researcherTeam: IAgent[]
  riskTeam: IAgent[]
  manager: IAgent
}

export class Orchestrator {
  private dataFetcher?: IAgent
  private technicalAnalyzer?: IAgent  // ← add this
  private researcherTeam: IAgent[]
  private riskTeam: IAgent[]
  private manager: IAgent

  constructor(config: OrchestratorConfig) {
    this.dataFetcher = config.dataFetcher
    this.technicalAnalyzer = config.technicalAnalyzer  // ← add this
    this.researcherTeam = config.researcherTeam
    this.riskTeam = config.riskTeam
    this.manager = config.manager
  }
```

In `run()`, insert the TechnicalAnalyzer stage after DataFetcher:

```typescript
  async run(ticker: string, market: Market): Promise<TradingReport> {
    let report: TradingReport = {
      ticker,
      market,
      timestamp: new Date(),
      rawData: [],
      researchFindings: [],
    }

    // Stage 1: Fetch data
    if (this.dataFetcher) {
      report = await this.dataFetcher.run(report)
    }

    // Stage 2: Compute technical indicators
    if (this.technicalAnalyzer) {
      report = await this.technicalAnalyzer.run(report)
    }

    // Stage 3: Research team (parallel)
    // ... (existing parallel researcher code unchanged)
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator/Orchestrator.ts
git commit -m "feat: add TechnicalAnalyzer stage to orchestrator pipeline"
```

---

### Task 19: Wire up run.ts — fallback chain, TechnicalAnalyzer, RAG config

**Files:**
- Modify: `src/run.ts`
- Modify: `src/config/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update .env.example with new variables**

Replace `.env.example` contents:

```
# Copy this file to .env and fill in the keys you need.

# LLM provider (required)
DEEPSEEK_API_KEY=sk-...

# Data sources — at least one of these is needed for OHLCV data
FINNHUB_API_KEY=your_key_here

# Uncomment if you add other LLM providers:
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# GEMINI_API_KEY=AIza...

# RAG mode auto-detection:
# Full RAG (persistent): set both OPENAI_API_KEY and QDRANT_URL
# QDRANT_URL=http://localhost:6333

# In-memory RAG (local): set OLLAMA_HOST
# OLLAMA_HOST=http://localhost:11434
```

- [ ] **Step 2: Add RAG auto-detection helper to config.ts**

Add at the bottom of `src/config/config.ts`:

```typescript
export type RAGMode = 'qdrant' | 'memory' | 'disabled'

export function detectRAGMode(): RAGMode {
  if (process.env['OPENAI_API_KEY'] && process.env['QDRANT_URL']) return 'qdrant'
  if (process.env['OLLAMA_HOST']) return 'memory'
  return 'disabled'
}
```

- [ ] **Step 3: Rewrite run.ts with fallback chain, TechnicalAnalyzer, and RAG**

Replace `src/run.ts`:

```typescript
// src/run.ts — entry point for running a single stock analysis
// Usage: npx tsx src/run.ts AAPL US

import { Orchestrator } from './orchestrator/Orchestrator.js'
import { DataFetcher } from './agents/data/DataFetcher.js'
import { TechnicalAnalyzer } from './agents/analyzer/TechnicalAnalyzer.js'
import { BullResearcher } from './agents/researcher/BullResearcher.js'
import { BearResearcher } from './agents/researcher/BearResearcher.js'
import { NewsAnalyst } from './agents/researcher/NewsAnalyst.js'
import { FundamentalsAnalyst } from './agents/researcher/FundamentalsAnalyst.js'
import { RiskAnalyst } from './agents/risk/RiskAnalyst.js'
import { RiskManager } from './agents/risk/RiskManager.js'
import { Manager } from './agents/manager/Manager.js'
import { LLMRegistry } from './llm/registry.js'
import { FinnhubSource } from './data/finnhub.js'
import { YFinanceSource } from './data/yfinance.js'
import { FallbackDataSource } from './data/FallbackDataSource.js'
import { QdrantVectorStore } from './rag/qdrant.js'
import { InMemoryVectorStore } from './rag/InMemoryVectorStore.js'
import { Embedder } from './rag/embedder.js'
import { OllamaEmbedder } from './rag/OllamaEmbedder.js'
import { agentConfig, detectRAGMode } from './config/config.js'
import type { Market } from './agents/base/types.js'
import type { IVectorStore } from './rag/IVectorStore.js'

const ticker = process.argv[2] ?? 'AAPL'
const market = (process.argv[3] ?? 'US') as Market

console.log(`\nAnalyzing ${ticker} on ${market} market...\n`)

// --- Data source fallback chain ---
const dataSources = []
if (process.env['FINNHUB_API_KEY']) {
  dataSources.push(new FinnhubSource())
}
dataSources.push(new YFinanceSource())

const fallbackSource = new FallbackDataSource('price-chain', dataSources)

// --- RAG mode auto-detection ---
const ragMode = detectRAGMode()
let vectorStore: IVectorStore | undefined
let embedder: { embed(text: string): Promise<number[]>; embedBatch(texts: string[]): Promise<number[][]> } | undefined

if (ragMode === 'qdrant') {
  console.log('[RAG] Full mode: Qdrant + OpenAI embeddings')
  vectorStore = new QdrantVectorStore({
    url: process.env['QDRANT_URL']!,
    collectionName: 'traderagent',
  })
  embedder = new Embedder({ apiKey: process.env['OPENAI_API_KEY']! })
} else if (ragMode === 'memory') {
  console.log('[RAG] In-memory mode: local store + Ollama embeddings')
  vectorStore = new InMemoryVectorStore()
  embedder = new OllamaEmbedder({ model: 'nomic-embed-text' })
} else {
  console.log('[RAG] Disabled — set OPENAI_API_KEY+QDRANT_URL or OLLAMA_HOST to enable')
}

// --- Build pipeline ---
const registry = new LLMRegistry(agentConfig)

const researcherConfig = { vectorStore, embedder }

const orchestrator = new Orchestrator({
  dataFetcher: new DataFetcher({
    dataSources: [fallbackSource],
    vectorStore,
    embedder,
  }),
  technicalAnalyzer: new TechnicalAnalyzer({ dataSource: fallbackSource }),
  researcherTeam: [
    new BullResearcher({ llm: registry.get('bullResearcher'), ...researcherConfig }),
    new BearResearcher({ llm: registry.get('bearResearcher'), ...researcherConfig }),
    new NewsAnalyst({ llm: registry.get('newsAnalyst'), ...researcherConfig }),
    new FundamentalsAnalyst({ llm: registry.get('fundamentalsAnalyst'), ...researcherConfig }),
  ],
  riskTeam: [
    new RiskAnalyst({ llm: registry.get('riskAnalyst') }),
    new RiskManager({ llm: registry.get('riskManager') }),
  ],
  manager: new Manager({ llm: registry.get('manager') }),
})

try {
  const report = await orchestrator.run(ticker, market)

  console.log('='.repeat(60))
  console.log(`FINAL DECISION: ${report.ticker} (${report.market})`)
  console.log('='.repeat(60))

  if (report.finalDecision) {
    const d = report.finalDecision
    console.log(`Action:      ${d.action}`)
    console.log(`Confidence:  ${(d.confidence * 100).toFixed(0)}%`)
    console.log(`Reasoning:   ${d.reasoning}`)
    if (d.suggestedPositionSize != null)
      console.log(`Position:    ${(d.suggestedPositionSize * 100).toFixed(1)}% of portfolio`)
    if (d.stopLoss != null) console.log(`Stop loss:   $${d.stopLoss}`)
    if (d.takeProfit != null) console.log(`Take profit: $${d.takeProfit}`)
  } else {
    console.log('No decision produced.')
  }

  if (report.computedIndicators) {
    const ci = report.computedIndicators
    console.log('\nComputed Indicators:')
    console.log(`  RSI: ${ci.momentum.rsi.toFixed(1)} | MACD: ${ci.trend.macd.line.toFixed(2)} | Beta: ${ci.risk.beta.toFixed(2)}`)
    console.log(`  Volatility: ${(ci.volatility.historicalVolatility * 100).toFixed(1)}% | MaxDD: ${(ci.risk.maxDrawdown * 100).toFixed(1)}% | VaR95: ${(ci.risk.var95 * 100).toFixed(2)}%`)
  }

  console.log('\nResearch findings:')
  for (const f of report.researchFindings) {
    console.log(`  [${f.agentName}] ${f.stance} (${(f.confidence * 100).toFixed(0)}%) — ${f.evidence.slice(0, 2).join('; ')}`)
  }

  if (report.riskAssessment) {
    const ra = report.riskAssessment
    console.log(`\nRisk: ${ra.riskLevel} | VaR: ${(ra.metrics.VaR * 100).toFixed(2)}% | Volatility: ${(ra.metrics.volatility * 100).toFixed(1)}%`)
  }
} catch (err) {
  console.error(`\nPIPELINE FAILED: ${(err as Error).message}`)
  process.exit(1)
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/run.ts src/config/config.ts .env.example
git commit -m "feat: wire up fallback data sources, TechnicalAnalyzer, and RAG auto-detection"
```

---

### Task 20: Integration test — run a full analysis

**Files:** None (manual verification)

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run a live analysis (requires DEEPSEEK_API_KEY + FINNHUB_API_KEY in .env)**

Run: `npm run run:analyze -- AAPL US`

Expected behavior:
1. DataFetcher tries Finnhub first. If candle endpoint 403s, falls back to YFinance.
2. If ohlcv/fundamentals/technicals fail from ALL sources → pipeline aborts with `PIPELINE FAILED: ABORT: ...`
3. If data succeeds → TechnicalAnalyzer computes all indicators (RSI, MACD, Bollinger, etc.)
4. Researchers receive computed indicators + raw data in their prompts
5. Evidence cites specific numbers from the data (not fabricated)
6. RiskAnalyst uses pre-computed VaR, volatility, beta, maxDrawdown
7. Manager produces final decision

- [ ] **Step 3: Verify output cites real data**

Check that research findings reference actual indicator values. If an agent says "RSI is 65.3" it should match (approximately) the computed RSI printed in the output.

- [ ] **Step 4: Commit any test fixes if needed**

```bash
git add -A
git commit -m "fix: integration test adjustments"
```
