import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Market } from '../agents/base/types.js'
import type { CalibratedThresholds } from '../types/quality.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('calibrated-threshold-store')

type ThresholdStoreOptions = {
  baseDir?: string
}

type SaveCalibratedThresholdsInput = {
  ticker: string
  market: Market
  calibratedThresholds: CalibratedThresholds
  baseDir?: string
}

type PersistedCalibratedThresholds = Omit<CalibratedThresholds, 'calibratedAt'> & {
  calibratedAt: string
}

export type CalibratedThresholdsLoader = (
  ticker: string,
  market: Market,
) => CalibratedThresholds | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_')
}

function getStoreDir(baseDir: string = process.cwd()): string {
  return join(baseDir, 'reports', 'calibrated-thresholds')
}

function getStorePath(ticker: string, market: Market, baseDir?: string): string {
  return join(
    getStoreDir(baseDir),
    `${sanitizeSegment(ticker)}_${sanitizeSegment(market)}.json`,
  )
}

function parsePersistedThresholds(value: unknown): CalibratedThresholds | undefined {
  if (!isRecord(value)) return undefined
  if (!isFiniteNumber(value['sampleSize']) || !isFiniteNumber(value['calibrationConfidence'])) {
    return undefined
  }

  const calibratedAt = new Date(String(value['calibratedAt'] ?? ''))
  if (Number.isNaN(calibratedAt.getTime())) return undefined

  const thresholds = value['thresholds']
  const hold = isRecord(thresholds) ? thresholds['hold'] : undefined
  if (
    !isRecord(thresholds)
    || !isFiniteNumber(thresholds['strongBuy'])
    || !isFiniteNumber(thresholds['buy'])
    || !Array.isArray(hold)
    || hold.length !== 2
    || !isFiniteNumber(hold[0])
    || !isFiniteNumber(hold[1])
    || !isFiniteNumber(thresholds['sell'])
    || !isFiniteNumber(thresholds['strongSell'])
  ) {
    return undefined
  }

  const dimensionWeights = value['dimensionWeights']
  if (!isRecord(dimensionWeights)) return undefined

  return {
    calibratedAt,
    sampleSize: value['sampleSize'],
    calibrationConfidence: value['calibrationConfidence'],
    thresholds: {
      strongBuy: thresholds['strongBuy'],
      buy: thresholds['buy'],
      hold: [hold[0], hold[1]],
      sell: thresholds['sell'],
      strongSell: thresholds['strongSell'],
    },
    dimensionWeights: Object.fromEntries(
      Object.entries(dimensionWeights)
        .filter(([, entry]) => isFiniteNumber(entry))
        .map(([key, entry]) => [key, entry as number]),
    ) as Record<string, number>,
  }
}

export function saveCalibratedThresholds(input: SaveCalibratedThresholdsInput): string {
  const filePath = getStorePath(input.ticker, input.market, input.baseDir)
  mkdirSync(getStoreDir(input.baseDir), { recursive: true })

  const payload: PersistedCalibratedThresholds = {
    ...input.calibratedThresholds,
    calibratedAt: input.calibratedThresholds.calibratedAt.toISOString(),
  }

  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
  log.info({ path: filePath, ticker: input.ticker, market: input.market }, 'Saved calibrated thresholds')
  return filePath
}

export function loadCalibratedThresholds(
  ticker: string,
  market: Market,
  options: ThresholdStoreOptions = {},
): CalibratedThresholds | undefined {
  const filePath = getStorePath(ticker, market, options.baseDir)
  if (!existsSync(filePath)) return undefined

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown
    const thresholds = parsePersistedThresholds(parsed)
    if (thresholds) {
      return thresholds
    }
  } catch (error) {
    log.warn({ path: filePath, error: error instanceof Error ? error.message : String(error) }, 'Failed to load calibrated thresholds')
    return undefined
  }

  log.warn({ path: filePath }, 'Ignoring malformed calibrated thresholds file')
  return undefined
}
