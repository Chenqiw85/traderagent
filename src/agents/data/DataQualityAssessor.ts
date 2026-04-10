import type { IAgent } from '../base/IAgent.js'
import type { TradingReport, AgentRole, ComputedIndicators, DataResult } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { DataQualityReport, DimensionQuality } from '../../types/quality.js'

type DataQualityAssessorConfig = {
  readonly llm: ILLMProvider
}

const FUNDAMENTALS_FIELDS = [
  'pe', 'pb', 'roe', 'debtToEquity', 'revenueGrowth', 'epsGrowth',
  'margins', 'currentRatio', 'interestCoverage', 'evToEbitda',
  'dividendYield', 'eps',
] as const

const TECHNICALS_FIELDS = [
  'rsi', 'macd', 'sma50', 'sma200', 'bollingerBands', 'atr', 'obv', 'stochastic',
] as const

export class DataQualityAssessor implements IAgent {
  readonly name = 'dataQualityAssessor'
  readonly role: AgentRole = 'data'
  private readonly llm: ILLMProvider

  constructor(config: DataQualityAssessorConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const fundamentalsData = this.findData(report.rawData, 'fundamentals')
    const newsData = this.findData(report.rawData, 'news')
    const ohlcvData = this.findData(report.rawData, 'ohlcv')

    const fundamentals = this.assessObject(fundamentalsData, FUNDAMENTALS_FIELDS)
    const news = this.assessArray(newsData)
    const technicals = report.computedIndicators
      ? this.assessComputedIndicators(report.computedIndicators)
      : this.assessObject(this.findData(report.rawData, 'technicals'), TECHNICALS_FIELDS)
    const ohlcv = this.assessArray(ohlcvData)

    const overall =
      (fundamentals.completeness + news.completeness + technicals.completeness + ohlcv.completeness) / 4

    const advisory = await this.generateAdvisory(report.ticker, {
      fundamentals,
      news,
      technicals,
      ohlcv,
      overall,
    })

    const dataQuality: DataQualityReport = {
      fundamentals,
      news,
      technicals,
      ohlcv,
      overall,
      advisory,
    }

    return { ...report, dataQuality }
  }

  private findData(rawData: readonly DataResult[], type: string): unknown {
    const result = rawData.find((d) => d.type === type)
    return result?.data ?? null
  }

  private assessObject(data: unknown, expectedFields: readonly string[]): DimensionQuality {
    if (data == null || typeof data !== 'object') {
      return { available: [], missing: [...expectedFields], completeness: 0 }
    }

    const obj = data as Record<string, unknown>
    const available: string[] = []
    const missing: string[] = []

    for (const field of expectedFields) {
      if (obj[field] != null && obj[field] !== '') {
        available.push(field)
      } else {
        missing.push(field)
      }
    }

    const completeness = expectedFields.length > 0 ? available.length / expectedFields.length : 0
    return { available, missing, completeness }
  }

  private assessArray(data: unknown): DimensionQuality {
    if (data == null) {
      return { available: [], missing: ['data'], completeness: 0 }
    }

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return { available: [], missing: ['items'], completeness: 0 }
      }
      return { available: [`${data.length} items`], missing: [], completeness: 1 }
    }

    return { available: ['data'], missing: [], completeness: 1 }
  }

  private assessComputedIndicators(ci: ComputedIndicators): DimensionQuality {
    const available: string[] = []
    const missing: string[] = []

    const checks: [string, unknown][] = [
      ['rsi', ci.momentum.rsi],
      ['macd', ci.trend.macd.line],
      ['sma50', ci.trend.sma50],
      ['sma200', ci.trend.sma200],
      ['bollingerBands', ci.volatility.bollingerMiddle],
      ['atr', ci.volatility.atr],
      ['obv', ci.volume.obv],
      ['stochastic', ci.momentum.stochastic.k],
    ]

    for (const [name, value] of checks) {
      if (value != null && Number.isFinite(value as number) && (value as number) !== 0) {
        available.push(name)
      } else {
        missing.push(name)
      }
    }

    const completeness = checks.length > 0 ? available.length / checks.length : 0
    return { available, missing, completeness }
  }

  private async generateAdvisory(
    ticker: string,
    quality: Omit<DataQualityReport, 'advisory'>,
  ): Promise<string> {
    const summary = [
      `Fundamentals: ${quality.fundamentals.completeness * 100}% complete (available: ${quality.fundamentals.available.join(', ') || 'none'}, missing: ${quality.fundamentals.missing.join(', ') || 'none'})`,
      `News: ${quality.news.completeness * 100}% complete (available: ${quality.news.available.join(', ') || 'none'}, missing: ${quality.news.missing.join(', ') || 'none'})`,
      `Technicals: ${quality.technicals.completeness * 100}% complete (available: ${quality.technicals.available.join(', ') || 'none'}, missing: ${quality.technicals.missing.join(', ') || 'none'})`,
      `OHLCV: ${quality.ohlcv.completeness * 100}% complete`,
      `Overall: ${quality.overall * 100}%`,
    ].join('\n')

    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are a data quality assessor for stock analysis. Given the data quality summary for ${ticker}, write a concise advisory note (1-3 sentences) explaining which analysis dimensions are reliable and which should be treated with caution. Focus on practical impact for downstream analysis.`,
      },
      {
        role: 'user',
        content: summary,
      },
    ])

    return response.trim()
  }
}
