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
