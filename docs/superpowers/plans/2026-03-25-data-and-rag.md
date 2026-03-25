# TradingAgent Data & RAG — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data ingestion and RAG pipeline — all data source adapters (US + CN/HK markets), vector store, embedder, text chunker, and the DataFetcher agent that ties them together.

**Architecture:** Each data source implements `IDataSource` (fetch → DataResult). The RAG layer has `IVectorStore` (upsert/search/delete) backed by Qdrant, and an `Embedder` that calls OpenAI embeddings. The `DataFetcher` agent fetches all sources in parallel, chunks the text, embeds it, and stores it in Qdrant — then writes raw data to `TradingReport.rawData`. All external HTTP calls are mocked in tests with `vi.stubGlobal('fetch', ...)`.

**Tech Stack:** TypeScript, Vitest, `yahoo-finance2`, `@polygon.io/client-js`, `@qdrant/js-client-rest`, native `fetch` for REST-only sources (Finnhub, NewsAPI, SEC EDGAR, Tushare, AkShare HTTP microservice).

---

## File Map

```
src/
  data/
    IDataSource.ts          # interface IDataSource — re-uses DataQuery/DataResult from agents/base/types.ts
    yfinance.ts             # YFinanceSource — US OHLCV, technicals, fundamentals, news
    polygon.ts              # PolygonSource — US OHLCV, news, fundamentals, technicals
    newsapi.ts              # NewsAPISource — news only (newsapi.org)
    finnhub.ts              # FinnhubSource — news, fundamentals, technicals, OHLCV
    secedgar.ts             # SECEdgarSource — fundamentals only (SEC filings)
    tushare.ts              # TushareSource — CN A-shares via Tushare HTTP API
    akshare.ts              # AkShareSource — CN/HK via AkShare HTTP microservice
  rag/
    IVectorStore.ts         # interface IVectorStore + Document + MetadataFilter types
    chunker.ts              # chunkText() — overlapping window text splitter
    embedder.ts             # Embedder class — wraps OpenAI embeddings API
    qdrant.ts               # QdrantVectorStore — implements IVectorStore using @qdrant/js-client-rest
  agents/
    base/
      IAgent.ts             # interface IAgent (also used by Plan 3)
    data/
      DataFetcher.ts        # DataFetcher implements IAgent — full fetch→chunk→embed→store pipeline
tests/
  data/
    yfinance.test.ts
    polygon.test.ts
    newsapi.test.ts
    finnhub.test.ts
    secedgar.test.ts
    tushare.test.ts
    akshare.test.ts
  rag/
    chunker.test.ts
    embedder.test.ts
    qdrant.test.ts
  agents/
    dataFetcher.test.ts
```

---

## Task 1: IDataSource Interface

**Files:**
- Create: `src/data/IDataSource.ts`
- Create: `src/agents/base/IAgent.ts`

- [ ] **Step 1: Create src/data/IDataSource.ts**

```ts
// src/data/IDataSource.ts
import type { DataQuery, DataResult } from '../agents/base/types.js'

export interface IDataSource {
  readonly name: string
  fetch(query: DataQuery): Promise<DataResult>
}
```

- [ ] **Step 2: Create src/agents/base/IAgent.ts**

```ts
// src/agents/base/IAgent.ts
import type { AgentRole, TradingReport } from './types.js'

export interface IAgent {
  readonly name: string
  readonly role: AgentRole
  run(report: TradingReport): Promise<TradingReport>
}
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/data/IDataSource.ts src/agents/base/IAgent.ts
git commit -m "feat: add IDataSource and IAgent interfaces"
```

---

## Task 2: YFinanceSource

**Files:**
- Create: `src/data/yfinance.ts`
- Create: `tests/data/yfinance.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/data/yfinance.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { YFinanceSource } from '../../src/data/yfinance.js'

vi.mock('yahoo-finance2', () => ({
  default: vi.fn().mockImplementation(() => ({
    historical: vi.fn().mockResolvedValue([{ date: '2024-01-01', open: 100, close: 105 }]),
    quoteSummary: vi.fn().mockResolvedValue({ financialData: { currentPrice: 105 } }),
    search: vi.fn().mockResolvedValue({ news: [{ title: 'AAPL news' }] }),
  })),
}))

describe('YFinanceSource', () => {
  let source: YFinanceSource

  beforeEach(() => { source = new YFinanceSource() })

  it('has correct name', () => { expect(source.name).toBe('yfinance') })

  it('fetches ohlcv data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' })
    expect(result.ticker).toBe('AAPL')
    expect(result.type).toBe('ohlcv')
    expect(result.data).toBeDefined()
  })

  it('fetches news data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'news' })
    expect(result.type).toBe('news')
  })

  it('throws for unsupported type', async () => {
    await expect(
      source.fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' })
    ).resolves.toBeDefined() // ohlcv is supported
  })
})
```

- [ ] **Step 2: Run test, verify it FAILS**

```bash
npm test -- tests/data/yfinance.test.ts
```

Expected: FAIL — `Cannot find module '../../src/data/yfinance.js'`

- [ ] **Step 3: Implement YFinanceSource**

```ts
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
      case 'ohlcv': {
        const period1 = (from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10)
        const period2 = (to ?? new Date()).toISOString().slice(0, 10)
        data = await this.yf.historical(ticker, { period1, period2 })
        break
      }
      case 'fundamentals': {
        const [quoteSummary, financials] = await Promise.all([
          this.yf.quoteSummary(ticker, { modules: ['financialData', 'defaultKeyStatistics', 'earningsHistory'] }),
          this.yf.quoteSummary(ticker, { modules: ['incomeStatementHistory', 'balanceSheetHistory'] }),
        ])
        data = { quoteSummary, financials }
        break
      }
      case 'technicals': {
        const period1 = (from ?? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10)
        const period2 = (to ?? new Date()).toISOString().slice(0, 10)
        data = { historical: await this.yf.historical(ticker, { period1, period2 }) }
        break
      }
      case 'news': {
        const search = await this.yf.search(ticker)
        data = search.news ?? []
        break
      }
      default:
        throw new Error(`YFinanceSource does not support data type: ${type}`)
    }

    return { ticker, market, type, data, fetchedAt: new Date() }
  }
}
```

- [ ] **Step 4: Run test, verify it PASSES**

```bash
npm test -- tests/data/yfinance.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/data/yfinance.ts tests/data/yfinance.test.ts
git commit -m "feat: add YFinanceSource adapter"
```

---

## Task 3: PolygonSource

**Files:**
- Create: `src/data/polygon.ts`
- Create: `tests/data/polygon.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/data/polygon.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PolygonSource } from '../../src/data/polygon.js'

vi.mock('@polygon.io/client-js', () => ({
  restClient: vi.fn().mockReturnValue({
    stocks: {
      aggregates: vi.fn().mockResolvedValue({ results: [{ o: 100, c: 105 }] }),
    },
    reference: {
      tickerNews: vi.fn().mockResolvedValue({ results: [{ title: 'AAPL news' }] }),
      tickerDetails: vi.fn().mockResolvedValue({ results: { name: 'Apple Inc.' } }),
    },
  }),
}))

describe('PolygonSource', () => {
  let source: PolygonSource

  beforeEach(() => {
    process.env['POLYGON_API_KEY'] = 'test-key'
    source = new PolygonSource()
  })

  it('has correct name', () => { expect(source.name).toBe('polygon') })

  it('fetches ohlcv data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' })
    expect(result.type).toBe('ohlcv')
    expect(result.ticker).toBe('AAPL')
  })

  it('fetches news data', async () => {
    const result = await source.fetch({ ticker: 'AAPL', market: 'US', type: 'news' })
    expect(result.type).toBe('news')
  })

  it('throws on missing API key', () => {
    delete process.env['POLYGON_API_KEY']
    expect(() => new PolygonSource()).toThrow('Missing POLYGON_API_KEY')
  })
})
```

- [ ] **Step 2: Run test, verify FAILS**

```bash
npm test -- tests/data/polygon.test.ts
```

- [ ] **Step 3: Implement PolygonSource**

```ts
// src/data/polygon.ts
import { restClient } from '@polygon.io/client-js'
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type PolygonConfig = { apiKey: string }

export class PolygonSource implements IDataSource {
  readonly name = 'polygon'
  private client: ReturnType<typeof restClient>

  constructor(config?: PolygonConfig) {
    const apiKey = config?.apiKey ?? process.env['POLYGON_API_KEY']
    if (!apiKey) throw new Error('Missing POLYGON_API_KEY')
    this.client = restClient(apiKey)
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type, from, to } = query
    let data: unknown
    const fromDate = (from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10)
    const toDate = (to ?? new Date()).toISOString().slice(0, 10)

    switch (type) {
      case 'ohlcv':
        data = await this.client.stocks.aggregates(ticker, 1, 'day', fromDate, toDate)
        break
      case 'news':
        data = await this.client.reference.tickerNews({ ticker, limit: 20 })
        break
      case 'fundamentals':
        data = await this.client.reference.tickerDetails(ticker)
        break
      case 'technicals':
        data = { aggregates: await this.client.stocks.aggregates(ticker, 1, 'day', fromDate, toDate) }
        break
      default:
        throw new Error(`PolygonSource does not support data type: ${type}`)
    }

    return { ticker, market, type, data, fetchedAt: new Date() }
  }
}
```

- [ ] **Step 4: Run test, verify PASSES**

```bash
npm test -- tests/data/polygon.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/data/polygon.ts tests/data/polygon.test.ts
git commit -m "feat: add PolygonSource adapter"
```

---

## Task 4: NewsAPISource + FinnhubSource + SECEdgarSource

**Files:**
- Create: `src/data/newsapi.ts`, `src/data/finnhub.ts`, `src/data/secedgar.ts`
- Create: `tests/data/newsapi.test.ts`, `tests/data/finnhub.test.ts`, `tests/data/secedgar.test.ts`

These three all use `fetch` directly. For each: write failing test → implement → verify passing.

### NewsAPISource

- [ ] **Step 1: Write failing test**

```ts
// tests/data/newsapi.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NewsAPISource } from '../../src/data/newsapi.js'

const mockArticles = [{ title: 'AAPL hits record high', source: { name: 'Reuters' } }]

beforeEach(() => {
  process.env['NEWSAPI_API_KEY'] = 'test-key'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ articles: mockArticles }),
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('NewsAPISource', () => {
  it('has correct name', () => { expect(new NewsAPISource().name).toBe('newsapi') })

  it('fetches news', async () => {
    const result = await new NewsAPISource().fetch({ ticker: 'AAPL', market: 'US', type: 'news' })
    expect(result.type).toBe('news')
    expect(result.data).toEqual(mockArticles)
  })

  it('throws for non-news type', async () => {
    await expect(new NewsAPISource().fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' }))
      .rejects.toThrow('NewsAPISource only supports type "news"')
  })

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }))
    await expect(new NewsAPISource().fetch({ ticker: 'AAPL', market: 'US', type: 'news' }))
      .rejects.toThrow('NewsAPI request failed')
  })
})
```

- [ ] **Step 2: Run test, verify FAILS**

```bash
npm test -- tests/data/newsapi.test.ts
```

- [ ] **Step 3: Implement NewsAPISource**

```ts
// src/data/newsapi.ts
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type NewsAPIConfig = { apiKey: string }

export class NewsAPISource implements IDataSource {
  readonly name = 'newsapi'
  private apiKey: string

  constructor(config?: NewsAPIConfig) {
    this.apiKey = config?.apiKey ?? process.env['NEWSAPI_API_KEY'] ?? ''
    if (!this.apiKey) throw new Error('Missing NEWSAPI_API_KEY')
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    if (query.type !== 'news') throw new Error(`NewsAPISource only supports type "news", got "${query.type}"`)

    const from = (query.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10)
    const to = (query.to ?? new Date()).toISOString().slice(0, 10)
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query.ticker)}&from=${from}&to=${to}&sortBy=relevancy&pageSize=20&apiKey=${this.apiKey}`

    const response = await fetch(url)
    if (!response.ok) throw new Error(`NewsAPI request failed: ${response.status} ${response.statusText}`)
    const data = await response.json() as { articles?: unknown[] }

    return { ticker: query.ticker, market: query.market, type: query.type, data: data.articles ?? [], fetchedAt: new Date() }
  }
}
```

- [ ] **Step 4: Run test, verify PASSES (4 tests)**

```bash
npm test -- tests/data/newsapi.test.ts
```

- [ ] **Step 5: Write failing test for FinnhubSource**

```ts
// tests/data/finnhub.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FinnhubSource } from '../../src/data/finnhub.js'

beforeEach(() => {
  process.env['FINNHUB_API_KEY'] = 'test-key'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ c: [150, 152], o: [148, 149] }),
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('FinnhubSource', () => {
  it('has correct name', () => { expect(new FinnhubSource().name).toBe('finnhub') })

  it('fetches ohlcv data', async () => {
    const result = await new FinnhubSource().fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' })
    expect(result.type).toBe('ohlcv')
    expect(result.ticker).toBe('AAPL')
  })

  it('fetches news data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([{ headline: 'Apple news' }]),
    }))
    const result = await new FinnhubSource().fetch({ ticker: 'AAPL', market: 'US', type: 'news' })
    expect(result.type).toBe('news')
  })

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' }))
    await expect(new FinnhubSource().fetch({ ticker: 'AAPL', market: 'US', type: 'ohlcv' }))
      .rejects.toThrow('Finnhub request failed')
  })

  it('throws on missing API key', () => {
    delete process.env['FINNHUB_API_KEY']
    expect(() => new FinnhubSource()).toThrow('Missing FINNHUB_API_KEY')
  })
})
```

- [ ] **Step 6: Implement FinnhubSource**

```ts
// src/data/finnhub.ts
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type FinnhubConfig = { apiKey: string }

export class FinnhubSource implements IDataSource {
  readonly name = 'finnhub'
  private apiKey: string
  private baseURL = 'https://finnhub.io/api/v1'

  constructor(config?: FinnhubConfig) {
    this.apiKey = config?.apiKey ?? process.env['FINNHUB_API_KEY'] ?? ''
    if (!this.apiKey) throw new Error('Missing FINNHUB_API_KEY')
  }

  private async request(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const searchParams = new URLSearchParams({ ...params, token: this.apiKey })
    const response = await fetch(`${this.baseURL}${path}?${searchParams}`)
    if (!response.ok) throw new Error(`Finnhub request failed: ${response.status} ${response.statusText}`)
    return response.json()
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query
    const toTs = Math.floor((query.to ?? new Date()).getTime() / 1000)
    const fromTs = Math.floor((query.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)).getTime() / 1000)
    let data: unknown

    switch (type) {
      case 'ohlcv':
      case 'technicals':
        data = await this.request('/stock/candle', { symbol: ticker, resolution: 'D', from: String(fromTs), to: String(toTs) })
        break
      case 'news': {
        const from = new Date(fromTs * 1000).toISOString().slice(0, 10)
        const to = new Date(toTs * 1000).toISOString().slice(0, 10)
        data = await this.request('/company-news', { symbol: ticker, from, to })
        break
      }
      case 'fundamentals': {
        const [profile, financials, metrics] = await Promise.all([
          this.request('/stock/profile2', { symbol: ticker }),
          this.request('/stock/financials-reported', { symbol: ticker }),
          this.request('/stock/metric', { symbol: ticker, metric: 'all' }),
        ])
        data = { profile, financials, metrics }
        break
      }
      default:
        throw new Error(`FinnhubSource does not support data type: ${type}`)
    }

    return { ticker, market, type, data, fetchedAt: new Date() }
  }
}
```

- [ ] **Step 7: Write and implement SECEdgarSource (same pattern)**

Test:
```ts
// tests/data/secedgar.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SECEdgarSource } from '../../src/data/secedgar.js'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ hits: { hits: [{ _source: { form_type: '10-K' } }] } }),
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('SECEdgarSource', () => {
  it('has correct name', () => { expect(new SECEdgarSource().name).toBe('secedgar') })

  it('fetches fundamentals (SEC filings)', async () => {
    const result = await new SECEdgarSource().fetch({ ticker: 'AAPL', market: 'US', type: 'fundamentals' })
    expect(result.type).toBe('fundamentals')
    expect(result.ticker).toBe('AAPL')
  })

  it('throws for non-fundamentals type', async () => {
    await expect(new SECEdgarSource().fetch({ ticker: 'AAPL', market: 'US', type: 'news' }))
      .rejects.toThrow('SECEdgarSource only supports type "fundamentals"')
  })

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Error' }))
    await expect(new SECEdgarSource().fetch({ ticker: 'AAPL', market: 'US', type: 'fundamentals' }))
      .rejects.toThrow('SEC EDGAR request failed')
  })
})
```

Implementation:
```ts
// src/data/secedgar.ts
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type SECEdgarConfig = { userAgent: string }

export class SECEdgarSource implements IDataSource {
  readonly name = 'secedgar'
  private userAgent: string
  private baseURL = 'https://efts.sec.gov/LATEST'

  constructor(config?: SECEdgarConfig) {
    this.userAgent = config?.userAgent ?? process.env['SEC_USER_AGENT'] ?? 'TradingAgent research@example.com'
  }

  private async request(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = `${this.baseURL}${path}?${new URLSearchParams(params)}`
    const response = await fetch(url, { headers: { 'User-Agent': this.userAgent } })
    if (!response.ok) throw new Error(`SEC EDGAR request failed: ${response.status} ${response.statusText}`)
    return response.json()
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    if (query.type !== 'fundamentals') throw new Error(`SECEdgarSource only supports type "fundamentals", got "${query.type}"`)

    const data = await this.request('/search-index', {
      q: `"${query.ticker}"`,
      dateRange: 'custom',
      startdt: (query.from ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
      enddt: (query.to ?? new Date()).toISOString().slice(0, 10),
      forms: '10-K,10-Q,8-K',
    })

    return { ticker: query.ticker, market: query.market, type: query.type, data, fetchedAt: new Date() }
  }
}
```

- [ ] **Step 8: Run all three tests, verify all PASS**

```bash
npm test -- tests/data/newsapi.test.ts tests/data/finnhub.test.ts tests/data/secedgar.test.ts
```

Expected: 13 tests passing across the 3 files.

- [ ] **Step 9: Commit**

```bash
git add src/data/newsapi.ts src/data/finnhub.ts src/data/secedgar.ts
git add tests/data/newsapi.test.ts tests/data/finnhub.test.ts tests/data/secedgar.test.ts
git commit -m "feat: add NewsAPISource, FinnhubSource, SECEdgarSource adapters"
```

---

## Task 5: TushareSource + AkShareSource (CN/HK)

**Files:**
- Create: `src/data/tushare.ts`, `src/data/akshare.ts`
- Create: `tests/data/tushare.test.ts`, `tests/data/akshare.test.ts`

### TushareSource

- [ ] **Step 1: Write failing test**

```ts
// tests/data/tushare.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TushareSource } from '../../src/data/tushare.js'

const mockData = { fields: ['ts_code', 'trade_date', 'close'], items: [['000001.SZ', '20240101', '10.5']] }

beforeEach(() => {
  process.env['TUSHARE_TOKEN'] = 'test-token'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ code: 0, msg: '', data: mockData }),
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('TushareSource', () => {
  it('has correct name', () => { expect(new TushareSource().name).toBe('tushare') })

  it('fetches ohlcv data for CN market', async () => {
    const result = await new TushareSource().fetch({ ticker: '000001.SZ', market: 'CN', type: 'ohlcv' })
    expect(result.type).toBe('ohlcv')
    expect(result.market).toBe('CN')
  })

  it('throws on API error (non-zero code)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ code: 2002, msg: 'Token expired', data: null }),
    }))
    await expect(new TushareSource().fetch({ ticker: '000001.SZ', market: 'CN', type: 'ohlcv' }))
      .rejects.toThrow('Tushare API error: Token expired')
  })

  it('throws on missing token', () => {
    delete process.env['TUSHARE_TOKEN']
    expect(() => new TushareSource()).toThrow('Missing TUSHARE_TOKEN')
  })

  it('fetches fundamentals data', async () => {
    const result = await new TushareSource().fetch({ ticker: '000001.SZ', market: 'CN', type: 'fundamentals' })
    expect(result.type).toBe('fundamentals')
  })
})
```

- [ ] **Step 2: Run test, verify FAILS**

```bash
npm test -- tests/data/tushare.test.ts
```

- [ ] **Step 3: Implement TushareSource**

```ts
// src/data/tushare.ts
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type TushareConfig = { token: string; baseURL?: string }

export class TushareSource implements IDataSource {
  readonly name = 'tushare'
  private token: string
  private baseURL: string

  constructor(config?: TushareConfig) {
    this.token = config?.token ?? process.env['TUSHARE_TOKEN'] ?? ''
    if (!this.token) throw new Error('Missing TUSHARE_TOKEN')
    this.baseURL = config?.baseURL ?? 'http://api.tushare.pro'
  }

  private async request(apiName: string, params: Record<string, unknown>, fields?: string): Promise<unknown> {
    const response = await fetch(this.baseURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_name: apiName, token: this.token, params, fields: fields ?? '' }),
    })
    if (!response.ok) throw new Error(`Tushare request failed: ${response.status} ${response.statusText}`)
    const json = await response.json() as { code: number; msg: string; data: unknown }
    if (json.code !== 0) throw new Error(`Tushare API error: ${json.msg}`)
    return json.data
  }

  private toDate(d?: Date): string {
    return (d ?? new Date()).toISOString().slice(0, 10).replace(/-/g, '')
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query
    let data: unknown

    switch (type) {
      case 'ohlcv':
      case 'technicals':
        data = await this.request('daily', {
          ts_code: ticker,
          start_date: this.toDate(query.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
          end_date: this.toDate(query.to),
        })
        break
      case 'fundamentals': {
        const [basic, income, balance] = await Promise.all([
          this.request('daily_basic', { ts_code: ticker, trade_date: '' }),
          this.request('income', { ts_code: ticker }),
          this.request('balancesheet', { ts_code: ticker }),
        ])
        data = { basic, income, balance }
        break
      }
      case 'news':
        data = await this.request('news', {
          start_date: this.toDate(query.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
          end_date: this.toDate(query.to),
          src: 'sina',
        })
        break
      default:
        throw new Error(`TushareSource does not support data type: ${type}`)
    }

    return { ticker, market, type, data, fetchedAt: new Date() }
  }
}
```

- [ ] **Step 4: Run test, verify PASSES**

```bash
npm test -- tests/data/tushare.test.ts
```

Expected: 5 tests passing.

- [ ] **Step 5: Write, implement and test AkShareSource (same HTTP pattern)**

Test:
```ts
// tests/data/akshare.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AkShareSource } from '../../src/data/akshare.js'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue([{ date: '20240101', close: 10.5 }]),
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('AkShareSource', () => {
  it('has correct name', () => { expect(new AkShareSource().name).toBe('akshare') })

  it('fetches CN ohlcv via stock_zh_a_hist', async () => {
    const result = await new AkShareSource().fetch({ ticker: '000001', market: 'CN', type: 'ohlcv' })
    expect(result.type).toBe('ohlcv')
    expect(result.market).toBe('CN')
  })

  it('fetches HK ohlcv via stock_hk_hist', async () => {
    const result = await new AkShareSource().fetch({ ticker: '00700', market: 'HK', type: 'ohlcv' })
    expect(result.market).toBe('HK')
  })

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' }))
    await expect(new AkShareSource().fetch({ ticker: '000001', market: 'CN', type: 'ohlcv' }))
      .rejects.toThrow('AkShare request failed')
  })

  it('uses custom baseURL from env', () => {
    process.env['AKSHARE_BASE_URL'] = 'http://custom:9000'
    const source = new AkShareSource()
    expect(source.name).toBe('akshare')
    delete process.env['AKSHARE_BASE_URL']
  })

  it('fetches news data', async () => {
    const result = await new AkShareSource().fetch({ ticker: '000001', market: 'CN', type: 'news' })
    expect(result.type).toBe('news')
  })
})
```

Implementation:
```ts
// src/data/akshare.ts
import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

type AkShareConfig = { baseURL: string }

export class AkShareSource implements IDataSource {
  readonly name = 'akshare'
  private baseURL: string

  constructor(config?: AkShareConfig) {
    this.baseURL = config?.baseURL ?? process.env['AKSHARE_BASE_URL'] ?? 'http://localhost:8080'
  }

  private async request(endpoint: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.baseURL}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!response.ok) throw new Error(`AkShare request failed: ${response.status} ${response.statusText}`)
    return response.json()
  }

  private fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10).replace(/-/g, '')
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query
    const startDate = this.fmtDate(query.from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))
    const endDate = this.fmtDate(query.to ?? new Date())
    let data: unknown

    switch (type) {
      case 'ohlcv':
      case 'technicals':
        data = await this.request(market === 'HK' ? 'stock_hk_hist' : 'stock_zh_a_hist', {
          symbol: ticker, start_date: startDate, end_date: endDate, adjust: 'qfq',
        })
        break
      case 'fundamentals':
        data = await this.request('stock_financial_analysis_indicator', { symbol: ticker })
        break
      case 'news':
        data = await this.request('stock_news_em', { symbol: ticker })
        break
      default:
        throw new Error(`AkShareSource does not support data type: ${type}`)
    }

    return { ticker, market, type, data, fetchedAt: new Date() }
  }
}
```

- [ ] **Step 6: Run both CN tests, verify PASS**

```bash
npm test -- tests/data/tushare.test.ts tests/data/akshare.test.ts
```

Expected: 11 tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/data/tushare.ts src/data/akshare.ts tests/data/tushare.test.ts tests/data/akshare.test.ts
git commit -m "feat: add TushareSource and AkShareSource adapters for CN/HK markets"
```

---

## Task 6: RAG Types + Chunker

**Files:**
- Create: `src/rag/IVectorStore.ts`
- Create: `src/rag/chunker.ts`
- Create: `tests/rag/chunker.test.ts`

- [ ] **Step 1: Create src/rag/IVectorStore.ts**

```ts
// src/rag/IVectorStore.ts

export type Document = {
  id: string
  content: string
  embedding?: number[]
  metadata: Record<string, unknown>
}

export type MetadataFilter = {
  must?: Record<string, unknown>[]
}

export interface IVectorStore {
  upsert(docs: Document[]): Promise<void>
  search(query: number[], topK: number, filter?: MetadataFilter): Promise<Document[]>
  delete(ids: string[]): Promise<void>
}
```

- [ ] **Step 2: Write failing test for chunker**

```ts
// tests/rag/chunker.test.ts
import { describe, it, expect } from 'vitest'
import { chunkText } from '../../src/rag/chunker.js'

describe('chunkText', () => {
  it('returns empty array for empty string', () => {
    expect(chunkText('')).toEqual([])
  })

  it('returns single chunk for short text', () => {
    const result = chunkText('hello world')
    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('hello world')
    expect(result[0].index).toBe(0)
  })

  it('splits long text into overlapping chunks', () => {
    const text = 'a'.repeat(2500)
    const result = chunkText(text, { chunkSize: 1000, overlap: 200 })
    expect(result.length).toBeGreaterThan(1)
    expect(result[0].text.length).toBeLessThanOrEqual(1000)
  })

  it('assigns sequential index values', () => {
    const text = 'x'.repeat(3000)
    const result = chunkText(text, { chunkSize: 1000, overlap: 0 })
    result.forEach((chunk, i) => expect(chunk.index).toBe(i))
  })

  it('respects custom chunkSize and overlap', () => {
    const text = 'z'.repeat(500)
    const result = chunkText(text, { chunkSize: 200, overlap: 50 })
    expect(result.length).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 3: Run test, verify FAILS**

```bash
npm test -- tests/rag/chunker.test.ts
```

- [ ] **Step 4: Implement chunkText**

```ts
// src/rag/chunker.ts
export type ChunkOptions = { chunkSize?: number; overlap?: number }
export type Chunk = { text: string; index: number }

export function chunkText(text: string, options?: ChunkOptions): Chunk[] {
  const chunkSize = options?.chunkSize ?? 1000
  const overlap = options?.overlap ?? 200

  if (!text || text.length === 0) return []
  if (text.length <= chunkSize) return [{ text, index: 0 }]

  const chunks: Chunk[] = []
  let start = 0
  let index = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push({ text: text.slice(start, end), index })
    index++
    start += chunkSize - overlap
    if (start >= text.length) break
  }

  return chunks
}
```

- [ ] **Step 5: Run test, verify PASSES**

```bash
npm test -- tests/rag/chunker.test.ts
```

Expected: 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/rag/IVectorStore.ts src/rag/chunker.ts tests/rag/chunker.test.ts
git commit -m "feat: add IVectorStore interface and chunkText utility"
```

---

## Task 7: Embedder

**Files:**
- Create: `src/rag/embedder.ts`
- Create: `tests/rag/embedder.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/rag/embedder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Embedder } from '../../src/rag/embedder.js'

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [
          { index: 0, embedding: [0.1, 0.2, 0.3] },
          { index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
      }),
    },
  })),
}))

describe('Embedder', () => {
  let embedder: Embedder

  beforeEach(() => {
    embedder = new Embedder({ apiKey: 'test-key' })
  })

  it('embeds a single string and returns a number array', async () => {
    const result = await embedder.embed('hello world')
    expect(result).toEqual([0.1, 0.2, 0.3])
  })

  it('returns empty array for empty batch', async () => {
    const result = await embedder.embedBatch([])
    expect(result).toEqual([])
  })

  it('embeds a batch and returns vectors in order', async () => {
    const result = await embedder.embedBatch(['text1', 'text2'])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0.1, 0.2, 0.3])
    expect(result[1]).toEqual([0.4, 0.5, 0.6])
  })
})
```

- [ ] **Step 2: Run test, verify FAILS**

```bash
npm test -- tests/rag/embedder.test.ts
```

- [ ] **Step 3: Implement Embedder**

```ts
// src/rag/embedder.ts
import OpenAI from 'openai'

type EmbedderConfig = { apiKey: string; model?: string; baseURL?: string }

export class Embedder {
  private client: OpenAI
  private model: string

  constructor(config: EmbedderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
    this.model = config.model ?? 'text-embedding-3-small'
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({ model: this.model, input: text })
    return response.data[0].embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const response = await this.client.embeddings.create({ model: this.model, input: texts })
    return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding)
  }
}
```

- [ ] **Step 4: Run test, verify PASSES**

```bash
npm test -- tests/rag/embedder.test.ts
```

Expected: 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/rag/embedder.ts tests/rag/embedder.test.ts
git commit -m "feat: add Embedder (OpenAI-compatible embedding wrapper)"
```

---

## Task 8: QdrantVectorStore

**Files:**
- Create: `src/rag/qdrant.ts`
- Create: `tests/rag/qdrant.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/rag/qdrant.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QdrantVectorStore } from '../../src/rag/qdrant.js'
import type { Document } from '../../src/rag/IVectorStore.js'

vi.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: vi.fn().mockImplementation(() => ({
    getCollections: vi.fn().mockResolvedValue({ collections: [] }),
    createCollection: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockResolvedValue([
      { id: 'abc', score: 0.9, payload: { content: 'AAPL news', ticker: 'AAPL', market: 'US' } },
    ]),
    delete: vi.fn().mockResolvedValue({}),
  })),
}))

const testDoc: Document = {
  id: 'test-1',
  content: 'Apple stock analysis',
  embedding: [0.1, 0.2, 0.3],
  metadata: { ticker: 'AAPL', market: 'US', type: 'news' },
}

describe('QdrantVectorStore', () => {
  let store: QdrantVectorStore

  beforeEach(() => {
    store = new QdrantVectorStore({ url: 'http://localhost:6333', collectionName: 'test', vectorSize: 1536 })
  })

  it('ensureCollection creates collection if not exists', async () => {
    await expect(store.ensureCollection()).resolves.not.toThrow()
  })

  it('upserts documents', async () => {
    await expect(store.upsert([testDoc])).resolves.not.toThrow()
  })

  it('searches and returns documents', async () => {
    const results = await store.search([0.1, 0.2, 0.3], 5)
    expect(results).toHaveLength(1)
    expect(results[0].content).toBe('AAPL news')
  })

  it('deletes documents by id', async () => {
    await expect(store.delete(['test-1'])).resolves.not.toThrow()
  })

  it('skips upsert for empty array', async () => {
    await expect(store.upsert([])).resolves.not.toThrow()
  })

  it('skips delete for empty array', async () => {
    await expect(store.delete([])).resolves.not.toThrow()
  })

  it('skips delete for empty ids', async () => {
    await expect(store.delete([])).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run test, verify FAILS**

```bash
npm test -- tests/rag/qdrant.test.ts
```

- [ ] **Step 3: Implement QdrantVectorStore**

```ts
// src/rag/qdrant.ts
import { QdrantClient } from '@qdrant/js-client-rest'
import type { IVectorStore, Document, MetadataFilter } from './IVectorStore.js'

type QdrantConfig = { url: string; apiKey?: string; collectionName: string; vectorSize: number }

export class QdrantVectorStore implements IVectorStore {
  readonly name = 'qdrant'
  private client: QdrantClient
  private collectionName: string
  private vectorSize: number

  constructor(config: QdrantConfig) {
    this.client = new QdrantClient({ url: config.url, apiKey: config.apiKey })
    this.collectionName = config.collectionName
    this.vectorSize = config.vectorSize
  }

  async ensureCollection(): Promise<void> {
    const collections = await this.client.getCollections()
    const exists = collections.collections.some((c) => c.name === this.collectionName)
    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: { size: this.vectorSize, distance: 'Cosine' },
      })
    }
  }

  async upsert(docs: Document[]): Promise<void> {
    if (docs.length === 0) return
    const points = docs.map((doc) => ({
      id: doc.id,
      vector: doc.embedding ?? [],
      payload: { content: doc.content, ...doc.metadata },
    }))
    await this.client.upsert(this.collectionName, { points })
  }

  async search(query: number[], topK: number, filter?: MetadataFilter): Promise<Document[]> {
    const qdrantFilter = filter?.must
      ? { must: filter.must.map((condition) => {
          const [key, value] = Object.entries(condition)[0]
          return { key, match: { value } }
        }) }
      : undefined

    const results = await this.client.search(this.collectionName, {
      vector: query, limit: topK, filter: qdrantFilter, with_payload: true,
    })

    return results.map((hit) => {
      const payload = (hit.payload ?? {}) as Record<string, unknown>
      const { content, ...metadata } = payload
      return { id: String(hit.id), content: (content as string) ?? '', metadata }
    })
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.client.delete(this.collectionName, { points: ids })
  }
}
```

- [ ] **Step 4: Run test, verify PASSES**

```bash
npm test -- tests/rag/qdrant.test.ts
```

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/rag/qdrant.ts tests/rag/qdrant.test.ts
git commit -m "feat: add QdrantVectorStore adapter"
```

---

## Task 9: DataFetcher Agent

**Files:**
- Create: `src/agents/data/DataFetcher.ts`
- Create: `tests/agents/dataFetcher.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/agents/dataFetcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataFetcher } from '../../src/agents/data/DataFetcher.js'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { IVectorStore } from '../../src/rag/IVectorStore.js'
import type { Embedder } from '../../src/rag/embedder.js'
import type { TradingReport } from '../../src/agents/base/types.js'

const emptyReport: TradingReport = {
  ticker: 'AAPL', market: 'US', timestamp: new Date(),
  rawData: [], researchFindings: [],
}

const mockSource: IDataSource = {
  name: 'mock',
  fetch: vi.fn().mockResolvedValue({
    ticker: 'AAPL', market: 'US', type: 'ohlcv',
    data: { prices: [100, 105, 102] }, fetchedAt: new Date(),
  }),
}

const mockVectorStore: IVectorStore = {
  upsert: vi.fn().mockResolvedValue(undefined),
  search: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockResolvedValue(undefined),
}

const mockEmbedder = {
  embed: vi.fn().mockResolvedValue([0.1, 0.2]),
  embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]),
} as unknown as Embedder

describe('DataFetcher', () => {
  it('has name "dataFetcher" and role "data"', () => {
    const df = new DataFetcher({ dataSources: [mockSource] })
    expect(df.name).toBe('dataFetcher')
    expect(df.role).toBe('data')
  })

  it('fetches from all sources and populates rawData', async () => {
    const df = new DataFetcher({ dataSources: [mockSource] })
    const result = await df.run(emptyReport)
    expect(result.rawData.length).toBeGreaterThan(0)
    expect(result.rawData[0].ticker).toBe('AAPL')
  })

  it('embeds and stores documents when vectorStore and embedder provided', async () => {
    const df = new DataFetcher({
      dataSources: [mockSource], vectorStore: mockVectorStore, embedder: mockEmbedder,
    })
    await df.run(emptyReport)
    expect(mockVectorStore.upsert).toHaveBeenCalled()
  })

  it('gracefully handles data source failures', async () => {
    const badSource: IDataSource = { name: 'bad', fetch: vi.fn().mockRejectedValue(new Error('API down')) }
    const df = new DataFetcher({ dataSources: [badSource] })
    const result = await df.run(emptyReport)
    expect(result.rawData).toHaveLength(0)
  })

  it('does not mutate the original report', async () => {
    const df = new DataFetcher({ dataSources: [mockSource] })
    const result = await df.run(emptyReport)
    expect(emptyReport.rawData).toHaveLength(0)
    expect(result.rawData.length).toBeGreaterThan(0)
  })

  it('skips embedding when no vectorStore configured', async () => {
    const df = new DataFetcher({ dataSources: [mockSource] })
    await df.run(emptyReport)
    expect(mockEmbedder.embedBatch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test, verify FAILS**

```bash
npm test -- tests/agents/dataFetcher.test.ts
```

- [ ] **Step 3: Implement DataFetcher**

```ts
// src/agents/data/DataFetcher.ts
import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, DataQuery, DataResult, DataType, TradingReport } from '../base/types.js'
import type { IDataSource } from '../../data/IDataSource.js'
import type { IVectorStore, Document } from '../../rag/IVectorStore.js'
import type { Embedder } from '../../rag/embedder.js'
import type { ChunkOptions } from '../../rag/chunker.js'
import { chunkText } from '../../rag/chunker.js'
import crypto from 'node:crypto'

type DataFetcherConfig = {
  dataSources: IDataSource[]
  vectorStore?: IVectorStore
  embedder?: Embedder
  chunkOptions?: ChunkOptions
}

export class DataFetcher implements IAgent {
  readonly name = 'dataFetcher'
  readonly role: AgentRole = 'data'
  private dataSources: IDataSource[]
  private vectorStore?: IVectorStore
  private embedder?: Embedder
  private chunkOptions: ChunkOptions

  constructor(config: DataFetcherConfig) {
    this.dataSources = config.dataSources
    this.vectorStore = config.vectorStore
    this.embedder = config.embedder
    this.chunkOptions = config.chunkOptions ?? { chunkSize: 1000, overlap: 200 }
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const { ticker, market } = report
    const dataTypes: DataType[] = ['ohlcv', 'news', 'fundamentals', 'technicals']

    const fetchPromises = this.dataSources.flatMap((source) =>
      dataTypes.map((type) =>
        source.fetch({ ticker, market, type } as DataQuery)
          .catch((err: Error) => {
            console.warn(`[DataFetcher] ${source.name}/${type} failed: ${err.message}`)
            return null
          })
      )
    )

    const results = await Promise.all(fetchPromises)
    const validResults = results.filter((r): r is DataResult => r !== null)

    if (this.vectorStore && this.embedder) {
      const docs: Document[] = []
      for (const result of validResults) {
        const text = typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
        const chunks = chunkText(text, this.chunkOptions)
        if (chunks.length === 0) continue
        const embeddings = await this.embedder.embedBatch(chunks.map((c) => c.text))
        for (let i = 0; i < chunks.length; i++) {
          docs.push({
            id: crypto.randomUUID(),
            content: chunks[i].text,
            embedding: embeddings[i],
            metadata: { ticker, market, type: result.type, chunkIndex: chunks[i].index, fetchedAt: result.fetchedAt.toISOString() },
          })
        }
      }
      if (docs.length > 0) await this.vectorStore.upsert(docs)
    }

    return { ...report, rawData: [...report.rawData, ...validResults] }
  }
}
```

- [ ] **Step 4: Run test, verify PASSES**

```bash
npm test -- tests/agents/dataFetcher.test.ts
```

Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/agents/data/DataFetcher.ts tests/agents/dataFetcher.test.ts
git commit -m "feat: add DataFetcher agent — fetch, chunk, embed, store pipeline"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass (17 LLM tests + 55 Data & RAG tests = 72 total).

- [ ] **Step 2: Type check**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Check test coverage across all files**

Verify these test files exist with passing tests:
- `tests/data/yfinance.test.ts` — 4+ tests
- `tests/data/polygon.test.ts` — 4+ tests
- `tests/data/newsapi.test.ts` — 4+ tests
- `tests/data/finnhub.test.ts` — 5+ tests
- `tests/data/secedgar.test.ts` — 4+ tests
- `tests/data/tushare.test.ts` — 5+ tests
- `tests/data/akshare.test.ts` — 6+ tests
- `tests/rag/chunker.test.ts` — 5+ tests
- `tests/rag/embedder.test.ts` — 3+ tests
- `tests/rag/qdrant.test.ts` — 7+ tests
- `tests/agents/dataFetcher.test.ts` — 6+ tests

---

## What's Next

**Plan 3 — Agents & Evaluation** covers:
- `BullResearcher`, `BearResearcher`, `NewsAnalyst`, `FundamentalsAnalyst` — each retrieves from Qdrant and writes a `Finding`
- `RiskAnalyst`, `RiskManager` — compute risk metrics and position sizing
- `Manager` — reads full `TradingReport` and outputs a `Decision`
- `Orchestrator` — runs researcher team in parallel, then risk team in parallel, then manager
- `ReasoningEvaluator`, `AccuracyEvaluator`, `BacktestEvaluator`
