import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IVectorStore } from '../../rag/IVectorStore.js'
import type { IEmbedder } from '../../rag/IEmbedder.js'
import { Backtester } from './Backtester.js'
import { CompositeScorer } from './CompositeScorer.js'
import { LessonExtractor } from './LessonExtractor.js'
import { LessonsJournal } from './LessonsJournal.js'
import { ReflectionEngine } from './ReflectionEngine.js'
import type { OhlcvBar, PassResult, ScoredDecision, TrainConfig, WindowResult } from './types.js'
import type { Orchestrator } from '../../orchestrator/Orchestrator.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('trader-agent')

type TraderAgentConfig = {
  orchestratorFactory: (cutoffDate: Date) => Orchestrator
  lessonLLM: ILLMProvider
  vectorStore?: IVectorStore
  embedder?: IEmbedder
  ohlcvBars: OhlcvBar[]
  /** Enable structured reflection on worst decisions. Default: true */
  reflectionEnabled?: boolean
}

export class TraderAgent {
  private readonly orchestratorFactory: (cutoffDate: Date) => Orchestrator
  private readonly lessonExtractor: LessonExtractor
  private readonly lessonsJournal: LessonsJournal
  private readonly reflectionEngine: ReflectionEngine | null
  private readonly ohlcvBars: OhlcvBar[]

  constructor(config: TraderAgentConfig) {
    this.orchestratorFactory = config.orchestratorFactory
    this.lessonExtractor = new LessonExtractor({ llm: config.lessonLLM })
    this.lessonsJournal = new LessonsJournal({
      vectorStore: config.vectorStore,
      embedder: config.embedder,
    })
    this.reflectionEngine = (config.reflectionEnabled ?? true)
      ? new ReflectionEngine({ llm: config.lessonLLM })
      : null
    this.ohlcvBars = config.ohlcvBars
  }

  async train(config: TrainConfig): Promise<PassResult[]> {
    const scorer = new CompositeScorer({ evaluationDays: config.evaluationDays })
    const windows = this.buildWindows()
    const results: PassResult[] = []
    let bestTestScore = Number.NEGATIVE_INFINITY
    let stagnantPasses = 0

    for (let passNumber = 1; passNumber <= config.maxPasses; passNumber++) {
      const backtester = new Backtester({
        orchestratorFactory: this.orchestratorFactory,
        scorer,
        ticker: config.ticker,
        market: config.market,
        ohlcvBars: this.ohlcvBars,
        evaluationDays: config.evaluationDays,
      })

      const trainDecisions = await backtester.replay(windows.train.start, windows.train.end)
      const testDecisions = await backtester.replay(windows.test.start, windows.test.end)

      const extractedLessons = await this.lessonExtractor.extract({
        decisions: trainDecisions,
        ticker: config.ticker,
        market: config.market,
        passNumber,
      })
      await this.lessonsJournal.store(extractedLessons)

      // Structured reflection on worst decisions
      if (this.reflectionEngine) {
        const reflections = await this.reflectionEngine.reflect({
          decisions: trainDecisions,
          ticker: config.ticker,
          market: config.market,
          passNumber,
        })
        if (reflections.length > 0) {
          log.info({ ticker: config.ticker, count: reflections.length, pass: passNumber }, 'Reflections generated')
          // Store reflections as lessons in the journal for future retrieval
          const reflectionLessons = reflections.flatMap((r) =>
            r.adjustments.map((adj) => ({
              id: r.id + '-adj',
              condition: `${r.action} on ${r.date} with return ${(r.actualReturn * 100).toFixed(1)}%`,
              lesson: adj,
              evidence: `Score: ${r.compositeScore.toFixed(3)}. Failed: ${r.whatFailed.join('; ')}`,
              confidence: 0.6,
              passNumber: r.passNumber,
              ticker: r.ticker,
              market: r.market,
            })),
          )
          await this.lessonsJournal.store(reflectionLessons)
        }
      }

      const passResult: PassResult = {
        passNumber,
        windows: [
          this.toWindowResult('Train', 'train', trainDecisions),
          this.toWindowResult('Test', 'test', testDecisions),
        ],
        avgTrainScore: this.averageScore(trainDecisions),
        avgTestScore: this.averageScore(testDecisions),
        lessonCount: extractedLessons.length,
      }

      results.push(passResult)

      const improvement = passResult.avgTestScore - bestTestScore
      if (improvement >= config.earlyStopThreshold) {
        bestTestScore = passResult.avgTestScore
        stagnantPasses = 0
      } else {
        if (bestTestScore === Number.NEGATIVE_INFINITY) {
          bestTestScore = passResult.avgTestScore
        }
        stagnantPasses += 1
      }

      if (stagnantPasses >= config.earlyStopPatience) {
        break
      }
    }

    return results
  }

  private buildWindows(): {
    train: { start: Date; end: Date }
    test: { start: Date; end: Date }
  } {
    const splitIndex = Math.max(1, Math.floor(this.ohlcvBars.length * 0.7))
    const trainStart = new Date(this.ohlcvBars[0]?.date ?? Date.now())
    const trainEnd = new Date(this.ohlcvBars[Math.max(0, splitIndex - 1)]?.date ?? trainStart)
    const testStart = new Date(this.ohlcvBars[Math.min(splitIndex, this.ohlcvBars.length - 1)]?.date ?? trainEnd)
    const testEnd = new Date(this.ohlcvBars[this.ohlcvBars.length - 1]?.date ?? testStart)

    return {
      train: { start: trainStart, end: trainEnd },
      test: { start: testStart, end: testEnd },
    }
  }

  private toWindowResult(
    label: string,
    windowType: 'train' | 'test',
    decisions: ScoredDecision[],
  ): WindowResult {
    const wins = decisions.filter((decision) => decision.breakdown.directional === 1).length
    return {
      label,
      windowType,
      totalDays: decisions.length,
      winRate: decisions.length === 0 ? 0 : wins / decisions.length,
      compositeScore: this.averageScore(decisions),
      decisions,
    }
  }

  private averageScore(decisions: ScoredDecision[]): number {
    if (decisions.length === 0) return 0
    return decisions.reduce((sum, decision) => sum + decision.compositeScore, 0) / decisions.length
  }
}
