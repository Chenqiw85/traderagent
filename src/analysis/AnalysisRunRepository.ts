import type { Prisma } from '@prisma/client'
import type { ActionTier, AnalysisArtifact, Market, TradingReport } from '../agents/base/types.js'
import { prisma } from '../db/client.js'

type StartRunInput = {
  ticker: string
  market: Market
  asOf: Date
  ragMode?: string
}

type CompleteRunInput = {
  finalAction?: ActionTier
  finalConfidence?: number
  artifacts: AnalysisArtifact[]
  snapshot?: TradingReport
}

type FailRunInput = {
  artifacts?: AnalysisArtifact[]
  snapshot?: TradingReport
}

function sanitizeJsonValue(value: unknown): Prisma.InputJsonValue | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (Array.isArray(value)) {
    const sanitizedArray: Array<Prisma.InputJsonValue | null> = []
    for (const item of value) {
      const sanitized = sanitizeJsonValue(item)
      if (sanitized !== undefined) {
        sanitizedArray.push(sanitized)
      }
    }
    return sanitizedArray
  }
  if (typeof value === 'object') {
    const sanitizedObject: Record<string, Prisma.InputJsonValue | null> = {}
    for (const [key, entryValue] of Object.entries(value)) {
      const sanitized = sanitizeJsonValue(entryValue)
      if (sanitized !== undefined) {
        sanitizedObject[key] = sanitized
      }
    }
    return sanitizedObject
  }

  return undefined
}

function sanitizeObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  const sanitizedObject: Record<string, Prisma.InputJsonValue | null> = {}
  for (const [key, entryValue] of Object.entries(value)) {
    const sanitized = sanitizeJsonValue(entryValue)
    if (sanitized !== undefined) {
      sanitizedObject[key] = sanitized
    }
  }
  return sanitizedObject
}

function sanitizePayload(payload: AnalysisArtifact['payload']): Prisma.InputJsonObject {
  return sanitizeObject(payload)
}

function sanitizeSnapshot(snapshot: TradingReport | undefined): Prisma.InputJsonObject | undefined {
  if (!snapshot) return undefined
  return sanitizeObject(snapshot as unknown as Record<string, unknown>)
}

type AnalysisRunDelegate = {
  create(args: {
    data: {
      ticker: string
      market: Market
      asOf: Date
      ragMode?: string
      status: string
    }
    select: { id: true }
  }): Promise<{ id: string }>
  update(args: {
    where: { id: string }
    data: {
      status: string
      finalAction?: ActionTier
      finalConfidence?: number
      snapshot?: Prisma.InputJsonObject
      completedAt: Date
    }
  }): Promise<unknown>
}

type AnalysisStageDelegate = {
  createMany(args: {
    data: Array<{
      runId: string
      stage: AnalysisArtifact['stage']
      agent: string
      summary: string
      payload: Prisma.InputJsonValue
    }>
  }): Promise<unknown>
}

type AnalysisRunPrismaClient = typeof prisma & {
  analysisRun: AnalysisRunDelegate
  analysisStage: AnalysisStageDelegate
}

export class AnalysisRunRepository {
  private readonly db = prisma as AnalysisRunPrismaClient

  async startRun({ ticker, market, asOf, ragMode }: StartRunInput): Promise<string> {
    const run = await this.db.analysisRun.create({
      data: {
        ticker,
        market,
        asOf,
        ragMode,
        status: 'running',
      },
      select: { id: true },
    })

    return run.id
  }

  async completeRun(
    id: string,
    { finalAction, finalConfidence, artifacts, snapshot }: CompleteRunInput,
  ): Promise<void> {
    await this.persistArtifacts(id, artifacts)

    await this.db.analysisRun.update({
      where: { id },
      data: {
        status: 'completed',
        finalAction,
        finalConfidence,
        snapshot: sanitizeSnapshot(snapshot),
        completedAt: new Date(),
      },
    })
  }

  async failRun(id: string, input: FailRunInput = {}): Promise<void> {
    await this.persistArtifacts(id, input.artifacts ?? [])

    await this.db.analysisRun.update({
      where: { id },
      data: {
        status: 'failed',
        snapshot: sanitizeSnapshot(input.snapshot),
        completedAt: new Date(),
      },
    })
  }

  private async persistArtifacts(id: string, artifacts: AnalysisArtifact[]): Promise<void> {
    if (artifacts.length === 0) return

    await this.db.analysisStage.createMany({
      data: artifacts.map((artifact) => ({
        runId: id,
        stage: artifact.stage,
        agent: artifact.agent,
        summary: artifact.summary,
        payload: sanitizePayload(artifact.payload),
      })),
    })
  }
}
