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
    it('deletes a watchlist entry by ticker and market', async () => {
      mockDelete.mockResolvedValue({ id: 1, ticker: 'AAPL' })
      await removeTicker('AAPL', 'US')
      expect(mockDelete).toHaveBeenCalledWith({
        where: { ticker_market: { ticker: 'AAPL', market: 'US' } },
      })
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
