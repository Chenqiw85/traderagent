import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readdirSync: mocks.readdirSync,
  readFileSync: mocks.readFileSync,
}))

import { ReportLoader } from '../../../src/agents/advisor/ReportLoader.js'

describe('ReportLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('propagates asOf from DB rows', async () => {
    const asOf = new Date('2026-04-02T20:00:00.000Z')
    const loader = new ReportLoader({
      db: {
        analysisRun: {
          findFirst: vi.fn().mockResolvedValue({
            asOf,
            snapshot: {
              ticker: 'AAPL',
              market: 'US',
              timestamp: asOf.toISOString(),
              rawData: [],
              researchFindings: [],
              finalDecision: { action: 'BUY', confidence: 0.7, reasoning: 'db' },
            },
          }),
        },
      } as never,
    })

    const result = await loader.loadLatest('AAPL', 'US')

    expect(result?.source).toBe('db')
    expect(result?.asOf.toISOString()).toBe('2026-04-02T20:00:00.000Z')
  })

  it('derives asOf from markdown filenames', async () => {
    mocks.readdirSync.mockReturnValue(['AAPL_US_2026-04-07_2030.md'])
    mocks.readFileSync.mockReturnValue(
      '**Action** | BUY\n**Confidence** | 70%\n**Reasoning** | test\n',
    )

    const loader = new ReportLoader()
    const result = await loader.loadLatest('AAPL', 'US')

    expect(result?.source).toBe('markdown')
    expect(result?.asOf.toISOString()).toBe('2026-04-07T20:30:00.000Z')
  })

  it('returns null for markdown files without a parseable timestamp', async () => {
    mocks.readdirSync.mockReturnValue(['AAPL_US_latest.md'])
    mocks.readFileSync.mockReturnValue(
      '**Action** | BUY\n**Confidence** | 70%\n**Reasoning** | test\n',
    )

    const loader = new ReportLoader()
    const result = await loader.loadLatest('AAPL', 'US')

    expect(result).toBeNull()
  })

  it('returns null for markdown files with an invalid timestamp', async () => {
    mocks.readdirSync.mockReturnValue(['AAPL_US_2026-99-99_9999.md'])
    mocks.readFileSync.mockReturnValue(
      '**Action** | BUY\n**Confidence** | 70%\n**Reasoning** | test\n',
    )

    const loader = new ReportLoader()
    const result = await loader.loadLatest('AAPL', 'US')

    expect(result).toBeNull()
  })

  it.each([
    'AAPL_US_2026-02-31_2030.md',
    'AAPL_US_2026-04-31_2030.md',
    'AAPL_US_2026-04-07_2400.md',
  ])('returns null for overflow timestamp filename %s', async (filename) => {
    mocks.readdirSync.mockReturnValue([filename])
    mocks.readFileSync.mockReturnValue(
      '**Action** | BUY\n**Confidence** | 70%\n**Reasoning** | test\n',
    )

    const loader = new ReportLoader()
    const result = await loader.loadLatest('AAPL', 'US')

    expect(result).toBeNull()
  })

  it('skips malformed newest markdown files and returns the next valid baseline', async () => {
    mocks.readdirSync.mockReturnValue([
      'AAPL_US_2026-04-31_2030.md',
      'AAPL_US_2026-04-07_2030.md',
    ])
    mocks.readFileSync.mockImplementation((path: unknown) => {
      if (String(path).includes('2026-04-07_2030.md')) {
        return '**Action** | BUY\n**Confidence** | 70%\n**Reasoning** | valid\n'
      }
      throw new Error('should not read invalid file')
    })

    const loader = new ReportLoader()
    const result = await loader.loadLatest('AAPL', 'US')

    expect(result?.source).toBe('markdown')
    expect(result?.asOf.toISOString()).toBe('2026-04-07T20:30:00.000Z')
    expect(result?.report.finalDecision?.reasoning).toBe('valid')
    expect(mocks.readFileSync).toHaveBeenCalledTimes(1)
  })

  it('loads a stable markdown file before scanning legacy timestamped files', async () => {
    mocks.readdirSync.mockReturnValue(['AAPL_US.md', 'AAPL_US_2026-04-07_2030.md'])
    mocks.readFileSync.mockImplementation((path: unknown) => {
      if (String(path).endsWith('AAPL_US.md')) {
        return [
          '# Analysis Report: AAPL (US)',
          '',
          '**Date:** 2026-04-08 20:30 UTC',
          '',
          '| **Action** | BUY |',
          '| **Confidence** | 70% |',
          '| **Reasoning** | stable |',
        ].join('\n')
      }
      throw new Error('legacy file should not be read when stable markdown is valid')
    })

    const loader = new ReportLoader()
    const result = await loader.loadLatest('AAPL', 'US')

    expect(result?.source).toBe('markdown')
    expect(result?.asOf.toISOString()).toBe('2026-04-08T20:30:00.000Z')
    expect(result?.report.finalDecision?.reasoning).toBe('stable')
    expect(mocks.readFileSync).toHaveBeenCalledTimes(1)
  })

  it('falls back to legacy timestamped markdown when the stable file has no parseable date', async () => {
    mocks.readdirSync.mockReturnValue(['AAPL_US.md', 'AAPL_US_2026-04-07_2030.md'])
    mocks.readFileSync.mockImplementation((path: unknown) => {
      if (String(path).endsWith('AAPL_US.md')) {
        return [
          '# Analysis Report: AAPL (US)',
          '',
          '| **Action** | HOLD |',
          '| **Confidence** | 55% |',
          '| **Reasoning** | missing date |',
        ].join('\n')
      }
      return '**Action** | BUY\n**Confidence** | 70%\n**Reasoning** | legacy\n'
    })

    const loader = new ReportLoader()
    const result = await loader.loadLatest('AAPL', 'US')

    expect(result?.source).toBe('markdown')
    expect(result?.asOf.toISOString()).toBe('2026-04-07T20:30:00.000Z')
    expect(result?.report.finalDecision?.reasoning).toBe('legacy')
    expect(mocks.readFileSync).toHaveBeenCalledTimes(2)
  })

  it.each([
    '**Date:** 2026-04-08 20:30 UTC+1',
    '**Date:** 2026-04-31 20:30 UTC',
    '**Date:**    2026-04-08 20:30 UTC',
  ])('falls back to legacy timestamped markdown when the stable file date is invalid: %s', async (dateLine) => {
    mocks.readdirSync.mockReturnValue(['AAPL_US.md', 'AAPL_US_2026-04-07_2030.md'])
    mocks.readFileSync.mockImplementation((path: unknown) => {
      if (String(path).endsWith('AAPL_US.md')) {
        return [
          '# Analysis Report: AAPL (US)',
          '',
          dateLine,
          '',
          '| **Action** | HOLD |',
          '| **Confidence** | 55% |',
          '| **Reasoning** | invalid stable date |',
        ].join('\n')
      }
      return '**Action** | BUY\n**Confidence** | 70%\n**Reasoning** | legacy\n'
    })

    const loader = new ReportLoader()
    const result = await loader.loadLatest('AAPL', 'US')

    expect(result?.source).toBe('markdown')
    expect(result?.asOf.toISOString()).toBe('2026-04-07T20:30:00.000Z')
    expect(result?.report.finalDecision?.reasoning).toBe('legacy')
    expect(mocks.readFileSync).toHaveBeenCalledTimes(2)
  })
})
