import { prisma } from '../../db/client.js'
import type { Market } from '../base/types.js'
import type { TickerAdvisory } from './types.js'
import { isAbstainForecast } from './types.js'

type SaveManyInput = {
  issuedAt: Date
  advisories: readonly TickerAdvisory[]
}

type AdvisorForecastCreateManyRow = {
  ticker: string
  market: string
  issuedAt: Date
  targetSession: Date
  predictedDirection: string
  referencePrice: number
  targetPrice: number
  confidence: number
  baselineAction: string
  baselineAsOf: Date
  changeFromBaseline: string
  atrRangeLow: number | null
  atrRangeHigh: number | null
}

export type AdvisorForecastRow = {
  id: string
  ticker: string
  market: string
  issuedAt: Date
  targetSession: Date
  predictedDirection: string
  referencePrice: number
  targetPrice: number
  confidence: number
  baselineAction: string
  baselineAsOf: Date
  changeFromBaseline: string
  atrRangeLow: number | null
  atrRangeHigh: number | null
  scoringStatus: string | null
  actualClose: number | null
  actualDirection: string | null
  scoredAt: Date | null
}

type MarkScoredArgs = {
  actualClose: number | null
  actualDirection: string | null
  status: 'scored' | 'no-data'
}

type AdvisorForecastDelegate = {
  createMany(args: { data: AdvisorForecastCreateManyRow[] }): Promise<unknown>
  findMany(args: unknown): Promise<AdvisorForecastRow[]>
  update(args: unknown): Promise<unknown>
}

type AdvisorForecastPrismaClient = typeof prisma & {
  advisorForecast: AdvisorForecastDelegate
}

function parseTargetSession(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export class AdvisorForecastRepository {
  private readonly db = prisma as AdvisorForecastPrismaClient

  async saveMany(input: SaveManyInput): Promise<void> {
    const rows = input.advisories.flatMap((advisory): AdvisorForecastCreateManyRow[] => {
      if (!advisory.forecast || !advisory.baselineDecision || !advisory.baselineAsOf) {
        return []
      }
      const targetSession = parseTargetSession(advisory.forecast.targetSession)
      if (!targetSession) return []

      if (isAbstainForecast(advisory.forecast)) {
        return [{
          ticker: advisory.ticker,
          market: advisory.market,
          issuedAt: input.issuedAt,
          targetSession,
          predictedDirection: 'abstain',
          referencePrice: advisory.forecast.referencePrice,
          targetPrice: advisory.forecast.referencePrice,
          confidence: 0,
          baselineAction: advisory.baselineDecision.action,
          baselineAsOf: advisory.baselineAsOf,
          changeFromBaseline: 'unchanged',
          atrRangeLow: null,
          atrRangeHigh: null,
        }]
      }

      const atrLow = advisory.forecast.atrRange ? advisory.forecast.atrRange[0] : null
      const atrHigh = advisory.forecast.atrRange ? advisory.forecast.atrRange[1] : null

      return [{
        ticker: advisory.ticker,
        market: advisory.market,
        issuedAt: input.issuedAt,
        targetSession,
        predictedDirection: advisory.forecast.predictedDirection,
        referencePrice: advisory.forecast.referencePrice,
        targetPrice: advisory.forecast.targetPrice,
        confidence: advisory.forecast.confidence,
        baselineAction: advisory.baselineDecision.action,
        baselineAsOf: advisory.baselineAsOf,
        changeFromBaseline: advisory.forecast.changeFromBaseline,
        atrRangeLow: atrLow,
        atrRangeHigh: atrHigh,
      }]
    })

    if (rows.length === 0) return
    await this.db.advisorForecast.createMany({ data: rows })
  }

  async findUnscored(before: Date): Promise<AdvisorForecastRow[]> {
    return this.db.advisorForecast.findMany({
      where: {
        targetSession: { lte: before },
        scoringStatus: null,
        predictedDirection: { not: 'abstain' },
      },
      orderBy: { targetSession: 'asc' },
    })
  }

  async markScored(id: string, args: MarkScoredArgs): Promise<void> {
    await this.db.advisorForecast.update({
      where: { id },
      data: {
        actualClose: args.actualClose,
        actualDirection: args.actualDirection,
        scoringStatus: args.status,
        scoredAt: new Date(),
      },
    })
  }

  async findRecentScored(ticker: string, market: Market, limit: number): Promise<AdvisorForecastRow[]> {
    return this.db.advisorForecast.findMany({
      where: {
        ticker,
        market,
        scoringStatus: 'scored',
        actualClose: { not: null },
      },
      orderBy: { issuedAt: 'desc' },
      take: limit,
    })
  }
}
