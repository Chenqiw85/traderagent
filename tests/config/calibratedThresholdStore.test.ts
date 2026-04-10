import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadCalibratedThresholds,
  saveCalibratedThresholds,
} from '../../src/config/calibratedThresholdStore.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'calibrated-thresholds-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('calibratedThresholdStore', () => {
  it('round-trips calibrated thresholds by ticker and market', () => {
    const baseDir = makeTempDir()
    const calibratedThresholds = {
      calibratedAt: new Date('2026-04-10T12:00:00.000Z'),
      sampleSize: 48,
      calibrationConfidence: 0.73,
      thresholds: {
        strongBuy: 5.5,
        buy: 2.8,
        hold: [-1.7, 2.1] as const,
        sell: -3.4,
        strongSell: -5.8,
      },
      dimensionWeights: {
        research: 0.3,
        technical: 0.25,
        fundamental: 0.2,
        risk: 0.15,
        proposal: 0.1,
      },
    }

    const savedPath = saveCalibratedThresholds({
      ticker: 'AAPL',
      market: 'US',
      calibratedThresholds,
      baseDir,
    })

    const loaded = loadCalibratedThresholds('AAPL', 'US', { baseDir })

    expect(savedPath).toContain('AAPL_US.json')
    expect(loaded).toEqual(calibratedThresholds)
  })

  it('returns undefined when no thresholds are stored for the ticker', () => {
    const baseDir = makeTempDir()

    const loaded = loadCalibratedThresholds('TSLA', 'US', { baseDir })

    expect(loaded).toBeUndefined()
  })
})
