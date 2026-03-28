# Stable Data Fetching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple data fetching from analysis by storing market data in Postgres, with scheduled daily syncs and DB-first reads with API fallback.

**Architecture:** PostgresDataSource (implements IDataSource) reads from Postgres as position-0 in the FallbackDataSource chain. DataSyncService fetches from existing API sources and writes to Postgres with retry logic. Scheduler triggers daily syncs via node-cron. Watchlist managed via DB table and CLI commands.

**Tech Stack:** PostgreSQL 16 (Docker Compose), Prisma ORM, node-cron, Vitest

**Spec:** `docs/superpowers/specs/2026-03-27-stable-data-fetching-design.md`

---

## File Structure

```
traderagent/
├── docker-compose.yml                    # NEW: Postgres container
├── prisma/
│   └── schema.prisma                     # NEW: 6 tables
├── src/
│   ├── db/
│   │   ├── client.ts                     # NEW: Prisma client singleton
│   │   └── PostgresDataSource.ts         # NEW: IDataSource from DB
│   ├── sync/
│   │   ├── DataSyncService.ts            # NEW: API→DB writer with retry
│   │   ├── Scheduler.ts                  # NEW: node-cron trigger
│   │   └── watchlist.ts                  # NEW: watchlist CRUD helpers
│   └── cli/
│       ├── sync.ts                       # NEW: db:sync entry point
│       ├── scheduler.ts                  # NEW: scheduler:start entry point
│       └── watchlist.ts                  # NEW: watchlist CLI entry point
│   ├── run.ts                            # MODIFY: prepend PostgresDataSource
├── tests/
│   ├── db/
│   │   └── PostgresDataSource.test.ts    # NEW
│   └── sync/
│       ├── DataSyncService.test.ts       # NEW
│       └── Scheduler.test.ts             # NEW
```

---

### Task 1: Docker Compose & Prisma Schema

**Files:**
- Create: `docker-compose.yml`
- Create: `prisma/schema.prisma`
- Modify: `package.json` (add dependencies and scripts)
- Modify: `.env.example` (add DATABASE_URL)

- [ ] **Step 1: Create docker-compose.yml**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: traderagent
      POSTGRES_USER: trader
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-tradersecret}
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

- [ ] **Step 2: Install dependencies**

Run: `npm install prisma @prisma/client node-cron && npm install -D @types/node-cron`
Expected: packages added to package.json

- [ ] **Step 3: Initialize Prisma**

Run: `npx prisma init --datasource-provider postgresql`
Expected: creates `prisma/schema.prisma` and adds `DATABASE_URL` to `.env`

- [ ] **Step 4: Write the Prisma schema**

Replace `prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Watchlist {
  id        Int      @id @default(autoincrement())
  ticker    String   @unique
  market    String   // US, CN, HK
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Ohlcv {
  id       Int      @id @default(autoincrement())
  ticker   String
  market   String
  date     DateTime
  open     Float
  high     Float
  low      Float
  close    Float
  volume   BigInt
  source   String
  fetchedAt DateTime @default(now())

  @@unique([ticker, date])
  @@index([ticker])
}

model Fundamentals {
  id       Int      @id @default(autoincrement())
  ticker   String
  market   String
  data     Json
  source   String
  fetchedAt DateTime @default(now())

  @@index([ticker])
}

model News {
  id          Int      @id @default(autoincrement())
  ticker      String
  market      String
  title       String
  url         String   @unique
  source      String
  publishedAt DateTime
  data        Json?
  fetchedAt   DateTime @default(now())

  @@index([ticker])
}

model Technicals {
  id         Int      @id @default(autoincrement())
  ticker     String
  market     String
  date       DateTime
  indicators Json
  computedAt DateTime @default(now())

  @@unique([ticker, date])
  @@index([ticker])
}

model FetchLog {
  id       Int      @id @default(autoincrement())
  ticker   String
  market   String
  dataType String
  source   String
  status   String   // success, failed
  error    String?
  duration Int      // milliseconds
  fetchedAt DateTime @default(now())

  @@index([ticker])
  @@index([fetchedAt])
}
```

- [ ] **Step 5: Add DATABASE_URL to .env.example**

Append to `.env.example`:
```
# Database (required for stable data fetching)
DATABASE_URL=postgresql://trader:tradersecret@localhost:5432/traderagent
POSTGRES_PASSWORD=tradersecret
```

- [ ] **Step 6: Add scripts to package.json**

Add these scripts to `package.json`:
```json
{
  "db:migrate": "prisma migrate dev",
  "db:generate": "prisma generate",
  "db:sync": "tsx --env-file=.env src/cli/sync.ts",
  "scheduler:start": "tsx --env-file=.env src/cli/scheduler.ts",
  "watchlist:add": "tsx --env-file=.env src/cli/watchlist.ts add",
  "watchlist:remove": "tsx --env-file=.env src/cli/watchlist.ts remove",
  "watchlist:list": "tsx --env-file=.env src/cli/watchlist.ts list"
}
```

- [ ] **Step 7: Start Postgres and run migration**

Run: `docker compose up -d && npx prisma migrate dev --name init`
Expected: Postgres starts, migration creates all 6 tables

- [ ] **Step 8: Generate Prisma client**

Run: `npx prisma generate`
Expected: Prisma client generated with typed models

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml prisma/ package.json package-lock.json .env.example
git commit -m "feat: add Docker Compose Postgres and Prisma schema with 6 tables"
```

---

### Task 2: Prisma Client Singleton

**Files:**
- Create: `src/db/client.ts`

- [ ] **Step 1: Create the Prisma client singleton**

```typescript
// src/db/client.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/client.ts
git commit -m "feat: add Prisma client singleton"
```

---

### Task 3: PostgresDataSource — Tests

**Files:**
- Create: `tests/db/PostgresDataSource.test.ts`

- [ ] **Step 1: Write tests for PostgresDataSource**

```typescript
// tests/db/PostgresDataSource.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DataQuery } from '../../src/agents/base/types.js'

// Mock Prisma client
const mockOhlcvFindMany = vi.fn()
const mockFundamentalsFindFirst = vi.fn()
const mockNewsFindMany = vi.fn()
const mockTechnicalsFindFirst = vi.fn()
const mockOhlcvCreateMany = vi.fn()
const mockFundamentalsCreate = vi.fn()
const mockNewsCreateMany = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  prisma: {
    ohlcv: { findMany: mockOhlcvFindMany, createMany: mockOhlcvCreateMany },
    fundamentals: { findFirst: mockFundamentalsFindFirst, create: mockFundamentalsCreate },
    news: { findMany: mockNewsFindMany, createMany: mockNewsCreateMany },
    technicals: { findFirst: mockTechnicalsFindFirst },
  },
}))

// Import after mock
const { PostgresDataSource } = await import('../../src/db/PostgresDataSource.js')

describe('PostgresDataSource', () => {
  let source: InstanceType<typeof PostgresDataSource>
  const now = new Date('2026-03-27T21:00:00Z') // after US market close

  beforeEach(() => {
    vi.clearAllMocks()
    vi.setSystemTime(now)
    source = new PostgresDataSource()
  })

  it('has correct name', () => {
    expect(source.name).toBe('postgres')
  })

  describe('ohlcv', () => {
    const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'ohlcv' }

    it('returns data when fresh rows exist', async () => {
      const rows = [
        { ticker: 'AAPL', date: new Date('2026-03-27'), open: 150, high: 155, low: 149, close: 153, volume: BigInt(1000000) },
        { ticker: 'AAPL', date: new Date('2026-03-26'), open: 148, high: 152, low: 147, close: 150, volume: BigInt(900000) },
      ]
      mockOhlcvFindMany.mockResolvedValue(rows)

      const result = await source.fetch(query)
      expect(result.ticker).toBe('AAPL')
      expect(result.type).toBe('ohlcv')
      expect(result.data).toEqual(rows)
      expect(result.fetchedAt).toBeInstanceOf(Date)
    })

    it('throws when no rows exist', async () => {
      mockOhlcvFindMany.mockResolvedValue([])
      await expect(source.fetch(query)).rejects.toThrow('No ohlcv data for AAPL in postgres')
    })
  })

  describe('fundamentals', () => {
    const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'fundamentals' }

    it('returns data when fresh record exists', async () => {
      const record = {
        ticker: 'AAPL',
        data: { pe: 28.5, pb: 12.3 },
        fetchedAt: new Date('2026-03-27T10:00:00Z'), // today
      }
      mockFundamentalsFindFirst.mockResolvedValue(record)

      const result = await source.fetch(query)
      expect(result.type).toBe('fundamentals')
      expect(result.data).toEqual({ pe: 28.5, pb: 12.3 })
    })

    it('throws when record is stale (>24h old)', async () => {
      const record = {
        ticker: 'AAPL',
        data: { pe: 28.5 },
        fetchedAt: new Date('2026-03-25T10:00:00Z'), // 2 days ago
      }
      mockFundamentalsFindFirst.mockResolvedValue(record)

      await expect(source.fetch(query)).rejects.toThrow('Stale fundamentals data for AAPL')
    })

    it('throws when no record exists', async () => {
      mockFundamentalsFindFirst.mockResolvedValue(null)
      await expect(source.fetch(query)).rejects.toThrow('No fundamentals data for AAPL in postgres')
    })
  })

  describe('news', () => {
    const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'news' }

    it('returns data when fresh articles exist', async () => {
      const articles = [
        { title: 'AAPL earnings', url: 'https://example.com/1', publishedAt: new Date('2026-03-27'), fetchedAt: new Date('2026-03-27T10:00:00Z') },
      ]
      mockNewsFindMany.mockResolvedValue(articles)

      const result = await source.fetch(query)
      expect(result.type).toBe('news')
      expect(result.data).toEqual(articles)
    })

    it('throws when no articles exist', async () => {
      mockNewsFindMany.mockResolvedValue([])
      await expect(source.fetch(query)).rejects.toThrow('No news data for AAPL in postgres')
    })
  })

  describe('technicals', () => {
    const query: DataQuery = { ticker: 'AAPL', market: 'US', type: 'technicals' }

    it('returns data when fresh record exists', async () => {
      const record = {
        ticker: 'AAPL',
        indicators: { sma50: 150, rsi14: 55 },
        computedAt: new Date('2026-03-27T10:00:00Z'),
      }
      mockTechnicalsFindFirst.mockResolvedValue(record)

      const result = await source.fetch(query)
      expect(result.type).toBe('technicals')
      expect(result.data).toEqual({ sma50: 150, rsi14: 55 })
    })

    it('throws when no record exists', async () => {
      mockTechnicalsFindFirst.mockResolvedValue(null)
      await expect(source.fetch(query)).rejects.toThrow('No technicals data for AAPL in postgres')
    })
  })

  describe('writeBack', () => {
    it('writes ohlcv data back to DB', async () => {
      mockOhlcvCreateMany.mockResolvedValue({ count: 2 })
      const bars = [
        { date: new Date('2026-03-27'), open: 150, high: 155, low: 149, close: 153, volume: 1000000 },
      ]
      await source.writeBack('AAPL', 'US', 'ohlcv', bars, 'yfinance')
      expect(mockOhlcvCreateMany).toHaveBeenCalled()
    })

    it('writes fundamentals data back to DB', async () => {
      mockFundamentalsCreate.mockResolvedValue({})
      await source.writeBack('AAPL', 'US', 'fundamentals', { pe: 28.5 }, 'yfinance')
      expect(mockFundamentalsCreate).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/PostgresDataSource.test.ts`
Expected: FAIL — module `../../src/db/PostgresDataSource.js` not found

- [ ] **Step 3: Commit**

```bash
git add tests/db/PostgresDataSource.test.ts
git commit -m "test: add PostgresDataSource tests (red)"
```

---

### Task 4: PostgresDataSource — Implementation

**Files:**
- Create: `src/db/PostgresDataSource.ts`

- [ ] **Step 1: Implement PostgresDataSource**

```typescript
// src/db/PostgresDataSource.ts
import type { IDataSource } from '../data/IDataSource.js'
import type { DataQuery, DataResult, DataType, Market } from '../agents/base/types.js'
import { prisma } from './client.js'

const FRESHNESS_HOURS: Record<DataType, number> = {
  ohlcv: 24,
  fundamentals: 24,
  technicals: 24,
  news: 24,
}

export class PostgresDataSource implements IDataSource {
  readonly name = 'postgres'

  async fetch(query: DataQuery): Promise<DataResult> {
    const { ticker, market, type } = query

    switch (type) {
      case 'ohlcv':
        return this.fetchOhlcv(ticker, market, query.from, query.to)
      case 'fundamentals':
        return this.fetchFundamentals(ticker, market)
      case 'news':
        return this.fetchNews(ticker, market, query.from, query.to)
      case 'technicals':
        return this.fetchTechnicals(ticker, market)
      default:
        throw new Error(`PostgresDataSource does not support data type: ${type}`)
    }
  }

  private async fetchOhlcv(
    ticker: string,
    market: Market,
    from?: Date,
    to?: Date,
  ): Promise<DataResult> {
    const period1 = from ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const period2 = to ?? new Date()

    const rows = await prisma.ohlcv.findMany({
      where: {
        ticker,
        date: { gte: period1, lte: period2 },
      },
      orderBy: { date: 'asc' },
    })

    if (rows.length === 0) {
      throw new Error(`No ohlcv data for ${ticker} in postgres`)
    }

    return { ticker, market, type: 'ohlcv', data: rows, fetchedAt: new Date() }
  }

  private async fetchFundamentals(ticker: string, market: Market): Promise<DataResult> {
    const record = await prisma.fundamentals.findFirst({
      where: { ticker },
      orderBy: { fetchedAt: 'desc' },
    })

    if (!record) {
      throw new Error(`No fundamentals data for ${ticker} in postgres`)
    }

    const ageHours = (Date.now() - record.fetchedAt.getTime()) / (1000 * 60 * 60)
    if (ageHours > FRESHNESS_HOURS.fundamentals) {
      throw new Error(`Stale fundamentals data for ${ticker} (${Math.round(ageHours)}h old)`)
    }

    return { ticker, market, type: 'fundamentals', data: record.data, fetchedAt: record.fetchedAt }
  }

  private async fetchNews(
    ticker: string,
    market: Market,
    from?: Date,
    to?: Date,
  ): Promise<DataResult> {
    const period1 = from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const period2 = to ?? new Date()

    const articles = await prisma.news.findMany({
      where: {
        ticker,
        publishedAt: { gte: period1, lte: period2 },
      },
      orderBy: { publishedAt: 'desc' },
    })

    if (articles.length === 0) {
      throw new Error(`No news data for ${ticker} in postgres`)
    }

    return { ticker, market, type: 'news', data: articles, fetchedAt: new Date() }
  }

  private async fetchTechnicals(ticker: string, market: Market): Promise<DataResult> {
    const record = await prisma.technicals.findFirst({
      where: { ticker },
      orderBy: { computedAt: 'desc' },
    })

    if (!record) {
      throw new Error(`No technicals data for ${ticker} in postgres`)
    }

    const ageHours = (Date.now() - record.computedAt.getTime()) / (1000 * 60 * 60)
    if (ageHours > FRESHNESS_HOURS.technicals) {
      throw new Error(`Stale technicals data for ${ticker} (${Math.round(ageHours)}h old)`)
    }

    return { ticker, market, type: 'technicals', data: record.indicators, fetchedAt: record.computedAt }
  }

  async writeBack(
    ticker: string,
    market: string,
    type: DataType,
    data: unknown,
    source: string,
  ): Promise<void> {
    switch (type) {
      case 'ohlcv': {
        const bars = data as Array<{
          date: Date
          open: number
          high: number
          low: number
          close: number
          volume: number
        }>
        await prisma.ohlcv.createMany({
          data: bars.map((bar) => ({
            ticker,
            market,
            date: bar.date,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: BigInt(bar.volume),
            source,
          })),
          skipDuplicates: true,
        })
        break
      }
      case 'fundamentals': {
        await prisma.fundamentals.create({
          data: { ticker, market, data: data as object, source },
        })
        break
      }
      case 'news': {
        const articles = data as Array<{
          title: string
          url: string
          publishedAt: Date
          data?: object
        }>
        await prisma.news.createMany({
          data: articles.map((a) => ({
            ticker,
            market,
            title: a.title,
            url: a.url,
            source,
            publishedAt: a.publishedAt,
            data: a.data ?? undefined,
          })),
          skipDuplicates: true,
        })
        break
      }
      case 'technicals': {
        // Technicals are computed by TechnicalAnalyzer, not written back from API
        break
      }
    }
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/db/PostgresDataSource.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/db/PostgresDataSource.ts
git commit -m "feat: implement PostgresDataSource with freshness checks and writeBack"
```

---

### Task 5: Watchlist CRUD — Tests

**Files:**
- Create: `tests/sync/watchlist.test.ts`

- [ ] **Step 1: Write watchlist tests**

```typescript
// tests/sync/watchlist.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const mockDelete = vi.fn()
const mockFindMany = vi.fn()
const mockUpdate = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  prisma: {
    watchlist: {
      create: mockCreate,
      delete: mockDelete,
      findMany: mockFindMany,
      update: mockUpdate,
    },
  },
}))

const { addTicker, removeTicker, listTickers } = await import('../../src/sync/watchlist.js')

describe('watchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('addTicker', () => {
    it('creates a new watchlist entry', async () => {
      mockCreate.mockResolvedValue({ id: 1, ticker: 'AAPL', market: 'US', active: true })
      const result = await addTicker('AAPL', 'US')
      expect(mockCreate).toHaveBeenCalledWith({
        data: { ticker: 'AAPL', market: 'US' },
      })
      expect(result.ticker).toBe('AAPL')
    })
  })

  describe('removeTicker', () => {
    it('deletes a watchlist entry by ticker', async () => {
      mockDelete.mockResolvedValue({ id: 1, ticker: 'AAPL' })
      await removeTicker('AAPL')
      expect(mockDelete).toHaveBeenCalledWith({ where: { ticker: 'AAPL' } })
    })
  })

  describe('listTickers', () => {
    it('returns all active tickers', async () => {
      const entries = [
        { id: 1, ticker: 'AAPL', market: 'US', active: true },
        { id: 2, ticker: 'MSFT', market: 'US', active: true },
      ]
      mockFindMany.mockResolvedValue(entries)
      const result = await listTickers()
      expect(mockFindMany).toHaveBeenCalledWith({ where: { active: true } })
      expect(result).toEqual(entries)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sync/watchlist.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Commit**

```bash
git add tests/sync/watchlist.test.ts
git commit -m "test: add watchlist CRUD tests (red)"
```

---

### Task 6: Watchlist CRUD — Implementation

**Files:**
- Create: `src/sync/watchlist.ts`

- [ ] **Step 1: Implement watchlist helpers**

```typescript
// src/sync/watchlist.ts
import { prisma } from '../db/client.js'
import type { Market } from '../agents/base/types.js'

export async function addTicker(ticker: string, market: Market) {
  return prisma.watchlist.create({
    data: { ticker, market },
  })
}

export async function removeTicker(ticker: string) {
  return prisma.watchlist.delete({
    where: { ticker },
  })
}

export async function listTickers() {
  return prisma.watchlist.findMany({
    where: { active: true },
  })
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/sync/watchlist.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/sync/watchlist.ts
git commit -m "feat: implement watchlist CRUD helpers"
```

---

### Task 7: DataSyncService — Tests

**Files:**
- Create: `tests/sync/DataSyncService.test.ts`

- [ ] **Step 1: Write DataSyncService tests**

```typescript
// tests/sync/DataSyncService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IDataSource } from '../../src/data/IDataSource.js'
import type { DataQuery, DataResult } from '../../src/agents/base/types.js'

const mockOhlcvCreateMany = vi.fn()
const mockFundamentalsCreate = vi.fn()
const mockNewsCreateMany = vi.fn()
const mockFetchLogCreate = vi.fn()
const mockWatchlistFindMany = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  prisma: {
    ohlcv: { createMany: mockOhlcvCreateMany },
    fundamentals: { create: mockFundamentalsCreate },
    news: { createMany: mockNewsCreateMany },
    fetchLog: { create: mockFetchLogCreate },
    watchlist: { findMany: mockWatchlistFindMany },
  },
}))

const { DataSyncService } = await import('../../src/sync/DataSyncService.js')

function makeSource(name: string, fetchFn: (q: DataQuery) => Promise<DataResult>): IDataSource {
  return { name, fetch: fetchFn }
}

describe('DataSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches all data types for a ticker and logs success', async () => {
    const source = makeSource('test-source', async (q) => ({
      ticker: q.ticker,
      market: q.market,
      type: q.type,
      data: { mock: true },
      fetchedAt: new Date(),
    }))

    mockOhlcvCreateMany.mockResolvedValue({ count: 1 })
    mockFundamentalsCreate.mockResolvedValue({})
    mockNewsCreateMany.mockResolvedValue({ count: 1 })
    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([source])
    await service.syncTicker('AAPL', 'US')

    // Should log success for each data type
    expect(mockFetchLogCreate).toHaveBeenCalledTimes(4) // ohlcv, fundamentals, news, technicals
  })

  it('retries on transient failure and eventually succeeds', async () => {
    let callCount = 0
    const source = makeSource('flaky', async (q) => {
      callCount++
      if (callCount <= 2) throw new Error('Connection timeout')
      return { ticker: q.ticker, market: q.market, type: q.type, data: {}, fetchedAt: new Date() }
    })

    mockOhlcvCreateMany.mockResolvedValue({ count: 0 })
    mockFundamentalsCreate.mockResolvedValue({})
    mockNewsCreateMany.mockResolvedValue({ count: 0 })
    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([source], { maxRetries: 3, baseDelayMs: 1 })
    await service.syncTicker('AAPL', 'US')

    // First data type failed twice then succeeded
    expect(callCount).toBeGreaterThan(2)
  })

  it('logs failure after all retries exhausted', async () => {
    const source = makeSource('broken', async () => {
      throw new Error('API down')
    })

    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([source], { maxRetries: 2, baseDelayMs: 1 })
    await service.syncTicker('AAPL', 'US')

    // Should have logged failures
    const failCalls = mockFetchLogCreate.mock.calls.filter(
      (call: any[]) => call[0].data.status === 'failed'
    )
    expect(failCalls.length).toBeGreaterThan(0)
  })

  it('syncAll iterates all active watchlist tickers', async () => {
    mockWatchlistFindMany.mockResolvedValue([
      { ticker: 'AAPL', market: 'US', active: true },
      { ticker: 'MSFT', market: 'US', active: true },
    ])

    const fetchedTickers: string[] = []
    const source = makeSource('tracker', async (q) => {
      fetchedTickers.push(q.ticker)
      return { ticker: q.ticker, market: q.market, type: q.type, data: {}, fetchedAt: new Date() }
    })

    mockOhlcvCreateMany.mockResolvedValue({ count: 0 })
    mockFundamentalsCreate.mockResolvedValue({})
    mockNewsCreateMany.mockResolvedValue({ count: 0 })
    mockFetchLogCreate.mockResolvedValue({})

    const service = new DataSyncService([source], { maxRetries: 1, baseDelayMs: 1 })
    await service.syncAll()

    expect(fetchedTickers).toContain('AAPL')
    expect(fetchedTickers).toContain('MSFT')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sync/DataSyncService.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Commit**

```bash
git add tests/sync/DataSyncService.test.ts
git commit -m "test: add DataSyncService tests (red)"
```

---

### Task 8: DataSyncService — Implementation

**Files:**
- Create: `src/sync/DataSyncService.ts`

- [ ] **Step 1: Implement DataSyncService**

```typescript
// src/sync/DataSyncService.ts
import type { IDataSource } from '../data/IDataSource.js'
import type { DataType, Market } from '../agents/base/types.js'
import { prisma } from '../db/client.js'

const DATA_TYPES: DataType[] = ['ohlcv', 'fundamentals', 'news', 'technicals']

type SyncOptions = {
  maxRetries?: number
  baseDelayMs?: number
}

export class DataSyncService {
  private sources: IDataSource[]
  private maxRetries: number
  private baseDelayMs: number

  constructor(sources: IDataSource[], options?: SyncOptions) {
    this.sources = sources
    this.maxRetries = options?.maxRetries ?? 3
    this.baseDelayMs = options?.baseDelayMs ?? 1000
  }

  async syncAll(): Promise<void> {
    const tickers = await prisma.watchlist.findMany({ where: { active: true } })
    console.log(`[DataSync] Syncing ${tickers.length} tickers`)

    for (const entry of tickers) {
      await this.syncTicker(entry.ticker, entry.market as Market)
    }

    console.log('[DataSync] Sync complete')
  }

  async syncTicker(ticker: string, market: Market): Promise<void> {
    console.log(`[DataSync] Syncing ${ticker} (${market})`)

    for (const dataType of DATA_TYPES) {
      await this.syncDataType(ticker, market, dataType)
    }
  }

  private async syncDataType(ticker: string, market: Market, dataType: DataType): Promise<void> {
    const start = Date.now()

    for (const source of this.sources) {
      let lastError: Error | null = null

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const result = await source.fetch({ ticker, market, type: dataType })
          await this.writeToDb(ticker, market, dataType, result.data, source.name)
          await this.logFetch(ticker, market, dataType, source.name, 'success', null, Date.now() - start)
          return // success
        } catch (err) {
          lastError = err as Error
          if (attempt < this.maxRetries) {
            const delay = this.baseDelayMs * Math.pow(4, attempt - 1)
            await new Promise((r) => setTimeout(r, delay))
          }
        }
      }

      console.warn(
        `[DataSync] ${source.name}/${dataType} failed for ${ticker} after ${this.maxRetries} retries: ${lastError?.message}`,
      )
    }

    // All sources failed for this data type
    await this.logFetch(ticker, market, dataType, 'all', 'failed', 'All sources exhausted', Date.now() - start)
  }

  private async writeToDb(
    ticker: string,
    market: string,
    dataType: DataType,
    data: unknown,
    source: string,
  ): Promise<void> {
    switch (dataType) {
      case 'ohlcv': {
        const rawData = data as { quotes?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
        const bars = Array.isArray(rawData) ? rawData : rawData.quotes ?? []
        if (bars.length === 0) return
        await prisma.ohlcv.createMany({
          data: bars.map((bar: Record<string, unknown>) => ({
            ticker,
            market,
            date: new Date(bar.date as string),
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
            volume: BigInt(Math.round(Number(bar.volume))),
            source,
          })),
          skipDuplicates: true,
        })
        break
      }
      case 'fundamentals': {
        await prisma.fundamentals.create({
          data: { ticker, market, data: data as object, source },
        })
        break
      }
      case 'news': {
        const rawNews = data as { news?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
        const articles = Array.isArray(rawNews) ? rawNews : rawNews.news ?? []
        if (articles.length === 0) return
        await prisma.news.createMany({
          data: articles.map((a: Record<string, unknown>) => ({
            ticker,
            market,
            title: String(a.title ?? 'Untitled'),
            url: String(a.link ?? a.url ?? `${ticker}-${Date.now()}-${Math.random()}`),
            source,
            publishedAt: a.publishedAt ? new Date(a.publishedAt as string) : new Date(),
            data: a as object,
          })),
          skipDuplicates: true,
        })
        break
      }
      case 'technicals': {
        // Raw technicals data is OHLCV — store as ohlcv with longer window
        // Actual indicator computation is done by TechnicalAnalyzer
        const rawData = data as { quotes?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
        const bars = Array.isArray(rawData) ? rawData : rawData.quotes ?? []
        if (bars.length === 0) return
        await prisma.ohlcv.createMany({
          data: bars.map((bar: Record<string, unknown>) => ({
            ticker,
            market,
            date: new Date(bar.date as string),
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
            volume: BigInt(Math.round(Number(bar.volume))),
            source,
          })),
          skipDuplicates: true,
        })
        break
      }
    }
  }

  private async logFetch(
    ticker: string,
    market: string,
    dataType: string,
    source: string,
    status: string,
    error: string | null,
    duration: number,
  ): Promise<void> {
    await prisma.fetchLog.create({
      data: { ticker, market, dataType, source, status, error, duration },
    })
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/sync/DataSyncService.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/sync/DataSyncService.ts
git commit -m "feat: implement DataSyncService with retry and fetch logging"
```

---

### Task 9: Scheduler — Tests

**Files:**
- Create: `tests/sync/Scheduler.test.ts`

- [ ] **Step 1: Write Scheduler tests**

```typescript
// tests/sync/Scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSchedule = vi.fn()
const mockValidate = vi.fn().mockReturnValue(true)

vi.mock('node-cron', () => ({
  default: {
    schedule: mockSchedule,
    validate: mockValidate,
  },
}))

const mockSyncAll = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/sync/DataSyncService.js', () => ({
  DataSyncService: vi.fn().mockImplementation(() => ({
    syncAll: mockSyncAll,
  })),
}))

const { Scheduler } = await import('../../src/sync/Scheduler.js')

describe('Scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('schedules a cron job with the given expression', () => {
    const scheduler = new Scheduler('30 16 * * 1-5')
    scheduler.start()

    expect(mockSchedule).toHaveBeenCalledTimes(1)
    expect(mockSchedule.mock.calls[0][0]).toBe('30 16 * * 1-5')
  })

  it('calls syncAll when cron fires', () => {
    mockSchedule.mockImplementation((_expr: string, callback: () => void) => {
      callback() // simulate cron firing
      return { stop: vi.fn() }
    })

    const scheduler = new Scheduler('30 16 * * 1-5')
    scheduler.start()

    expect(mockSyncAll).toHaveBeenCalledTimes(1)
  })

  it('uses default US market close cron if none provided', () => {
    const scheduler = new Scheduler()
    scheduler.start()

    // Default: 4:30 PM ET on weekdays = '30 16 * * 1-5'
    expect(mockSchedule.mock.calls[0][0]).toBe('30 16 * * 1-5')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sync/Scheduler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Commit**

```bash
git add tests/sync/Scheduler.test.ts
git commit -m "test: add Scheduler tests (red)"
```

---

### Task 10: Scheduler — Implementation

**Files:**
- Create: `src/sync/Scheduler.ts`

- [ ] **Step 1: Implement Scheduler**

```typescript
// src/sync/Scheduler.ts
import cron from 'node-cron'
import { DataSyncService } from './DataSyncService.js'
import { YFinanceSource } from '../data/yfinance.js'
import { FinnhubSource } from '../data/finnhub.js'

const DEFAULT_CRON = '30 16 * * 1-5' // 4:30 PM ET, weekdays

export class Scheduler {
  private cronExpression: string

  constructor(cronExpression?: string) {
    this.cronExpression = cronExpression ?? DEFAULT_CRON
  }

  start(): void {
    const sources = []
    if (process.env['FINNHUB_API_KEY']) {
      sources.push(new FinnhubSource())
    }
    sources.push(new YFinanceSource())

    const syncService = new DataSyncService(sources)

    console.log(`[Scheduler] Starting with cron: ${this.cronExpression}`)

    cron.schedule(this.cronExpression, () => {
      console.log(`[Scheduler] Cron fired at ${new Date().toISOString()}`)
      syncService.syncAll().catch((err) => {
        console.error('[Scheduler] Sync failed:', err)
      })
    })
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/sync/Scheduler.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/sync/Scheduler.ts
git commit -m "feat: implement Scheduler with configurable cron expression"
```

---

### Task 11: CLI Entry Points

**Files:**
- Create: `src/cli/sync.ts`
- Create: `src/cli/scheduler.ts`
- Create: `src/cli/watchlist.ts`

- [ ] **Step 1: Create sync CLI**

```typescript
// src/cli/sync.ts
import { DataSyncService } from '../sync/DataSyncService.js'
import { YFinanceSource } from '../data/yfinance.js'
import { FinnhubSource } from '../data/finnhub.js'
import type { Market } from '../agents/base/types.js'

async function main() {
  const args = process.argv.slice(2)
  const tickerIdx = args.indexOf('--ticker')

  const sources = []
  if (process.env['FINNHUB_API_KEY']) {
    sources.push(new FinnhubSource())
  }
  sources.push(new YFinanceSource())

  const service = new DataSyncService(sources)

  if (tickerIdx !== -1 && args[tickerIdx + 1]) {
    const ticker = args[tickerIdx + 1]
    const market = (args[tickerIdx + 2] ?? 'US') as Market
    console.log(`Syncing single ticker: ${ticker} (${market})`)
    await service.syncTicker(ticker, market)
  } else {
    console.log('Syncing all watchlist tickers...')
    await service.syncAll()
  }

  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error('Sync failed:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Create scheduler CLI**

```typescript
// src/cli/scheduler.ts
import { Scheduler } from '../sync/Scheduler.js'

const cronExpr = process.argv[2] // optional custom cron expression
const scheduler = new Scheduler(cronExpr)
scheduler.start()

console.log('Scheduler running. Press Ctrl+C to stop.')
```

- [ ] **Step 3: Create watchlist CLI**

```typescript
// src/cli/watchlist.ts
import { addTicker, removeTicker, listTickers } from '../sync/watchlist.js'
import type { Market } from '../agents/base/types.js'

async function main() {
  const [command, ...args] = process.argv.slice(2)

  switch (command) {
    case 'add': {
      const [ticker, market = 'US'] = args
      if (!ticker) {
        console.error('Usage: watchlist add <TICKER> [US|CN|HK]')
        process.exit(1)
      }
      const entry = await addTicker(ticker.toUpperCase(), market.toUpperCase() as Market)
      console.log(`Added ${entry.ticker} (${entry.market}) to watchlist`)
      break
    }
    case 'remove': {
      const [ticker] = args
      if (!ticker) {
        console.error('Usage: watchlist remove <TICKER>')
        process.exit(1)
      }
      await removeTicker(ticker.toUpperCase())
      console.log(`Removed ${ticker.toUpperCase()} from watchlist`)
      break
    }
    case 'list': {
      const entries = await listTickers()
      if (entries.length === 0) {
        console.log('Watchlist is empty')
      } else {
        console.log('Active watchlist:')
        for (const e of entries) {
          console.log(`  ${e.ticker} (${e.market})`)
        }
      }
      break
    }
    default:
      console.error('Usage: watchlist <add|remove|list> [args]')
      process.exit(1)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('Watchlist command failed:', err)
  process.exit(1)
})
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/sync.ts src/cli/scheduler.ts src/cli/watchlist.ts
git commit -m "feat: add CLI entry points for sync, scheduler, and watchlist"
```

---

### Task 12: Integrate PostgresDataSource into run.ts

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Read current run.ts to confirm exact integration point**

Run: `cat -n src/run.ts` and locate the data source construction lines (around lines 29–36).

- [ ] **Step 2: Add PostgresDataSource to the fallback chain**

Add import at the top of `src/run.ts`:
```typescript
import { PostgresDataSource } from './db/PostgresDataSource.js'
```

Modify the data source construction section to prepend PostgresDataSource:
```typescript
// --- Data source fallback chain ---
const dataSources = []

// Try Postgres first (local DB cache)
if (process.env['DATABASE_URL']) {
  dataSources.push(new PostgresDataSource())
}

// API fallbacks
if (process.env['FINNHUB_API_KEY']) {
  dataSources.push(new FinnhubSource())
}
dataSources.push(new YFinanceSource())

const fallbackSource = new FallbackDataSource('price-chain', dataSources)
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests still PASS

- [ ] **Step 4: Commit**

```bash
git add src/run.ts
git commit -m "feat: prepend PostgresDataSource to fallback chain in run.ts"
```

---

### Task 13: End-to-End Smoke Test

**Files:**
- No new files — manual verification

- [ ] **Step 1: Ensure Docker Postgres is running**

Run: `docker compose up -d`
Expected: Postgres container running

- [ ] **Step 2: Run Prisma migration**

Run: `npx prisma migrate dev --name init`
Expected: Migration applied successfully

- [ ] **Step 3: Add a ticker to the watchlist**

Run: `npm run watchlist:add -- AAPL US`
Expected: `Added AAPL (US) to watchlist`

- [ ] **Step 4: Verify watchlist**

Run: `npm run watchlist:list`
Expected: Shows `AAPL (US)`

- [ ] **Step 5: Run a manual sync**

Run: `npm run db:sync -- --ticker AAPL`
Expected: Fetches OHLCV, fundamentals, news, technicals for AAPL and writes to DB

- [ ] **Step 6: Run analysis (should read from DB)**

Run: `npm run run:analyze -- AAPL`
Expected: Pipeline runs, PostgresDataSource serves data from DB (check logs for `[price-chain] postgres/ohlcv` succeeding)

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Docker Compose + Prisma schema | `docker-compose.yml`, `prisma/schema.prisma` |
| 2 | Prisma client singleton | `src/db/client.ts` |
| 3 | PostgresDataSource tests (red) | `tests/db/PostgresDataSource.test.ts` |
| 4 | PostgresDataSource implementation (green) | `src/db/PostgresDataSource.ts` |
| 5 | Watchlist tests (red) | `tests/sync/watchlist.test.ts` |
| 6 | Watchlist implementation (green) | `src/sync/watchlist.ts` |
| 7 | DataSyncService tests (red) | `tests/sync/DataSyncService.test.ts` |
| 8 | DataSyncService implementation (green) | `src/sync/DataSyncService.ts` |
| 9 | Scheduler tests (red) | `tests/sync/Scheduler.test.ts` |
| 10 | Scheduler implementation (green) | `src/sync/Scheduler.ts` |
| 11 | CLI entry points | `src/cli/sync.ts`, `src/cli/scheduler.ts`, `src/cli/watchlist.ts` |
| 12 | Integrate into run.ts | `src/run.ts` |
| 13 | End-to-end smoke test | Manual verification |
