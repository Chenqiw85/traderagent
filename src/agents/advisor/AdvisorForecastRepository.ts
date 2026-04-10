import { prisma } from '../../db/client.js'
import type { TickerAdvisory } from './types.js'

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
}

type AdvisorForecastDelegate = {
  createMany(args: { data: AdvisorForecastCreateManyRow[] }): Promise<unknown>
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
    const rows = input.advisories.flatMap((advisory) => {
      if (!advisory.forecast || !advisory.baselineDecision || !advisory.baselineAsOf) {
        return []
      }

      const targetSession = parseTargetSession(advisory.forecast.targetSession)
      if (!targetSession) {
        return []
      }

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
      }]
    })

    if (rows.length === 0) return

    await this.db.advisorForecast.createMany({ data: rows })
  }
}
