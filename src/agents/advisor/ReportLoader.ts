// src/agents/advisor/ReportLoader.ts

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActionTier, Market, TradingReport } from '../base/types.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('report-loader')

const REPORTS_DIR = join(process.cwd(), 'reports')

type LoadedReport = {
  report: TradingReport
  source: 'db' | 'markdown'
  asOf: Date
}

export type ReportLoaderDeps = {
  readonly db?: {
    analysisRun: {
      findFirst(args: {
        where: { ticker: string; market: string; status: string }
        orderBy: { asOf: 'desc' }
        select: { snapshot: true; asOf: true }
      }): Promise<{ snapshot: unknown; asOf: Date } | null>
    }
  }
}

export class ReportLoader {
  private readonly db: ReportLoaderDeps['db']

  constructor(deps: ReportLoaderDeps = {}) {
    this.db = deps.db
  }

  async loadLatest(ticker: string, market: Market): Promise<LoadedReport | null> {
    log.info({ ticker, market, hasDb: !!this.db }, 'Loading latest report')
    // Try DB first
    if (this.db) {
      try {
        const row = await this.db.analysisRun.findFirst({
          where: { ticker, market, status: 'completed' },
          orderBy: { asOf: 'desc' },
          select: { snapshot: true, asOf: true },
        })
        if (row?.snapshot) {
          const report = this.parseSnapshot(row.snapshot, ticker, market)
          if (report) {
            log.info({ ticker, market, asOf: row.asOf }, 'Loaded report from DB')
            return { report, source: 'db', asOf: row.asOf }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn({ ticker, error: msg }, 'DB report load failed, trying markdown fallback')
      }
    }

    // Fall back to markdown files
    const report = this.loadFromMarkdown(ticker, market)
    if (report) {
      log.info({ ticker, market }, 'Loaded report from markdown')
      return report
    }

    log.info({ ticker, market }, 'No previous report found')
    return null
  }

  private parseSnapshot(snapshot: unknown, ticker: string, market: Market): TradingReport | null {
    if (!snapshot || typeof snapshot !== 'object') return null
    const s = snapshot as Record<string, unknown>

    // The snapshot is a serialized TradingReport — restore Date fields
    return {
      ticker: (s['ticker'] as string) ?? ticker,
      market: (s['market'] as Market) ?? market,
      timestamp: s['timestamp'] ? new Date(s['timestamp'] as string) : new Date(),
      rawData: (s['rawData'] as TradingReport['rawData']) ?? [],
      researchFindings: (s['researchFindings'] as TradingReport['researchFindings']) ?? [],
      computedIndicators: s['computedIndicators'] as TradingReport['computedIndicators'],
      researchThesis: s['researchThesis'] as TradingReport['researchThesis'],
      traderProposal: s['traderProposal'] as TradingReport['traderProposal'],
      riskAssessment: s['riskAssessment'] as TradingReport['riskAssessment'],
      riskVerdict: s['riskVerdict'] as TradingReport['riskVerdict'],
      finalDecision: s['finalDecision'] as TradingReport['finalDecision'],
      analysisArtifacts: s['analysisArtifacts'] as TradingReport['analysisArtifacts'],
    }
  }

  private loadFromMarkdown(ticker: string, market: Market): LoadedReport | null {
    try {
      const stableFile = `${ticker}_${market}.md`
      const prefix = `${ticker}_${market}_`
      const allFiles = readdirSync(REPORTS_DIR)
      const stableReport = this.loadStableMarkdown(ticker, market, stableFile, allFiles)
      if (stableReport) return stableReport

      log.info({ ticker, market, dir: REPORTS_DIR, prefix }, 'Searching markdown reports')
      const files = allFiles
        .filter((f) => f.startsWith(prefix) && f.endsWith('.md'))
        .sort()
        .reverse()

      log.info({ ticker, matched: files.length, first: files[0] }, 'Markdown report search result')
      if (files.length === 0) return null

      for (const latestFile of files) {
        const asOf = this.parseLegacyFilenameAsOf(latestFile)
        if (!asOf) {
          log.warn({ ticker, market, latestFile }, 'Markdown report filename did not include a parseable timestamp')
          continue
        }

        try {
          const content = readFileSync(join(REPORTS_DIR, latestFile), 'utf-8')
          const report = this.parseMarkdownReport(content, ticker, market)

          report.timestamp = asOf
          return { report, source: 'markdown', asOf }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.warn({ ticker, market, latestFile, error: msg }, 'Markdown report file could not be read')
        }
      }

      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn({ ticker, market, error: msg }, 'Markdown report load failed')
      return null
    }
  }

  private loadStableMarkdown(ticker: string, market: Market, stableFile: string, allFiles: readonly string[]): LoadedReport | null {
    if (!allFiles.includes(stableFile)) return null

    try {
      const content = readFileSync(join(REPORTS_DIR, stableFile), 'utf-8')
      const asOf = this.parseStableMarkdownAsOf(content)
      if (!asOf) {
        log.warn({ ticker, market, stableFile }, 'Stable markdown report date was missing or invalid, falling back to legacy files')
        return null
      }

      const report = this.parseMarkdownReport(content, ticker, market)
      report.timestamp = asOf
      return { report, source: 'markdown', asOf }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn({ ticker, market, stableFile, error: msg }, 'Stable markdown report file could not be read, falling back to legacy files')
      return null
    }
  }

  private parseStableMarkdownAsOf(content: string): Date | null {
    const match = content.match(/^\*\*Date:\*\* (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC$/m)
    if (!match) return null

    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const hour = Number(match[4])
    const minute = Number(match[5])
    const asOf = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
    const roundTrips =
      asOf.getUTCFullYear() === year &&
      asOf.getUTCMonth() === month - 1 &&
      asOf.getUTCDate() === day &&
      asOf.getUTCHours() === hour &&
      asOf.getUTCMinutes() === minute &&
      asOf.getUTCSeconds() === 0 &&
      asOf.getUTCMilliseconds() === 0

    return roundTrips ? asOf : null
  }

  private parseLegacyFilenameAsOf(fileName: string): Date | null {
    const match = fileName.match(/_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})\.md$/)
    if (!match) return null

    const year = Number(match[1].slice(0, 4))
    const month = Number(match[1].slice(5, 7))
    const day = Number(match[1].slice(8, 10))
    const hour = Number(match[2])
    const minute = Number(match[3])
    const asOf = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0))
    const roundTrips =
      asOf.getUTCFullYear() === year &&
      asOf.getUTCMonth() === month - 1 &&
      asOf.getUTCDate() === day &&
      asOf.getUTCHours() === hour &&
      asOf.getUTCMinutes() === minute &&
      asOf.getUTCSeconds() === 0 &&
      asOf.getUTCMilliseconds() === 0

    if (!roundTrips) {
      log.warn({ fileName }, 'Markdown report filename timestamp was invalid')
      return null
    }

    return asOf
  }

  private parseMarkdownReport(content: string, ticker: string, market: Market): TradingReport {
    // Extract structured data from markdown — best-effort parsing
    const report: TradingReport = {
      ticker,
      market,
      timestamp: new Date(),
      rawData: [],
      researchFindings: [],
    }

    // Extract decision
    const actionMatch = content.match(/\*\*Action\*\*\s*\|[^|]*(BUY|SELL|HOLD|OVERWEIGHT|UNDERWEIGHT)/i)
    const confidenceMatch = content.match(/\*\*Confidence\*\*\s*\|\s*(\d+)%/)
    const reasoningMatch = content.match(/\*\*Reasoning\*\*\s*\|\s*(.+)/)
    const stopLossMatch = content.match(/\*\*Stop Loss\*\*\s*\|[^$]*\$([\d.]+)/)
    const takeProfitMatch = content.match(/\*\*Take Profit\*\*\s*\|[^$]*\$([\d.]+)/)

    if (actionMatch) {
      report.finalDecision = {
        action: actionMatch[1].toUpperCase() as ActionTier,
        confidence: confidenceMatch ? Number(confidenceMatch[1]) / 100 : 0.5,
        reasoning: reasoningMatch?.[1]?.trim().replace(/\s*\|\s*$/, '') ?? '',
        stopLoss: stopLossMatch ? Number(stopLossMatch[1]) : undefined,
        takeProfit: takeProfitMatch ? Number(takeProfitMatch[1]) : undefined,
      }
    }

    // Extract indicators
    const sma50Match = content.match(/SMA 50\s*\|\s*\$?([\d.]+)/)
    const sma200Match = content.match(/SMA 200\s*\|\s*\$?([\d.]+)/)
    const rsiMatch = content.match(/RSI\s*\|\s*([\d.]+)/)
    const macdHistMatch = content.match(/MACD Histogram\s*\|\s*(-?[\d.]+)/)

    if (sma50Match || rsiMatch) {
      report.computedIndicators = {
        trend: {
          sma50: sma50Match ? Number(sma50Match[1]) : 0,
          sma200: sma200Match ? Number(sma200Match[1]) : 0,
          ema12: 0,
          ema26: 0,
          macd: { line: 0, signal: 0, histogram: macdHistMatch ? Number(macdHistMatch[1]) : 0 },
        },
        momentum: { rsi: rsiMatch ? Number(rsiMatch[1]) : 0, stochastic: { k: 0, d: 0 } },
        volatility: { bollingerUpper: 0, bollingerMiddle: 0, bollingerLower: 0, atr: 0, historicalVolatility: 0 },
        volume: { obv: 0 },
        risk: { beta: 0, maxDrawdown: 0, var95: 0 },
        fundamentals: { pe: null, pb: null, dividendYield: null, eps: null },
      }
    }

    // Extract research thesis
    const stanceMatch = content.match(/\*\*Stance:\*\*\s*(bull|bear|neutral)/i)
    const thesisSummaryMatch = content.match(/\*\*Summary:\*\*\s*(.+)/)
    if (stanceMatch && thesisSummaryMatch) {
      report.researchThesis = {
        stance: stanceMatch[1].toLowerCase() as 'bull' | 'bear' | 'neutral',
        confidence: confidenceMatch ? Number(confidenceMatch[1]) / 100 : 0.5,
        summary: thesisSummaryMatch[1].trim(),
        keyDrivers: [],
        keyRisks: [],
        invalidationConditions: [],
        timeHorizon: 'short',
      }
    }

    // Store raw markdown as an artifact for LLM context
    report.analysisArtifacts = [{
      stage: 'final',
      agent: 'report-loader',
      summary: 'Previous analysis report (markdown)',
      payload: { markdownContent: content },
    }]

    return report
  }
}
