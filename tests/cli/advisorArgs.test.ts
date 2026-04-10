import { describe, expect, it } from 'vitest'

import { parseAdvisorCliArgs } from '../../src/cli/advisorArgs.js'

describe('parseAdvisorCliArgs', () => {
  it('does not treat --dry-run as a ticker', () => {
    const parsed = parseAdvisorCliArgs(['--dry-run'])

    expect(parsed.isSchedule).toBe(false)
    expect(parsed.isDryRun).toBe(true)
    expect(parsed.tickerArg).toBeUndefined()
    expect(parsed.marketArg).toBeUndefined()
  })

  it('parses ticker and market while ignoring option flags', () => {
    const parsed = parseAdvisorCliArgs(['AAPL,MSFT', 'US', '--dry-run'])

    expect(parsed.isSchedule).toBe(false)
    expect(parsed.isDryRun).toBe(true)
    expect(parsed.tickerArg).toBe('AAPL,MSFT')
    expect(parsed.marketArg).toBe('US')
  })

  it('preserves schedule mode while ignoring option flags', () => {
    const parsed = parseAdvisorCliArgs(['schedule', '--dry-run'])

    expect(parsed.isSchedule).toBe(true)
    expect(parsed.isDryRun).toBe(true)
    expect(parsed.tickerArg).toBeUndefined()
  })
})
