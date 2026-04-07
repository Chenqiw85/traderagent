// src/agents/researcher/DebateEngine.ts

import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { Finding, TradingReport } from '../base/types.js'
import { parseJson } from '../../utils/parseJson.js'
import { withLanguage } from '../../utils/i18n.js'
import { tickerPreservationInstruction } from '../../prompts/tickerPreservation.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('debate-engine')

type DebateRound = {
  round: number
  bullArgument: Finding
  bearArgument: Finding
}

type DebateEngineConfig = {
  bullLlm: ILLMProvider
  bearLlm: ILLMProvider
  maxRounds: number
}

type DebateResult = {
  rounds: DebateRound[]
  bullFinal: Finding
  bearFinal: Finding
}

export class DebateEngine {
  private readonly bullLlm: ILLMProvider
  private readonly bearLlm: ILLMProvider
  private readonly maxRounds: number

  constructor(config: DebateEngineConfig) {
    this.bullLlm = config.bullLlm
    this.bearLlm = config.bearLlm
    this.maxRounds = config.maxRounds
  }

  /**
   * Run a multi-round debate between bull and bear analysts.
   * Each round, each side sees the other's previous argument and crafts a rebuttal.
   */
  async debate(
    report: TradingReport,
    initialBull: Finding,
    initialBear: Finding,
    indicators: string,
  ): Promise<DebateResult> {
    const rounds: DebateRound[] = []
    let currentBull = initialBull
    let currentBear = initialBear

    for (let round = 1; round <= this.maxRounds; round++) {
      log.info({ ticker: report.ticker, round, maxRounds: this.maxRounds }, 'Starting debate round')

      // Bull rebuts Bear's argument
      const bullRebuttal = await this.rebut(
        'bull',
        this.bullLlm,
        report,
        currentBull,
        currentBear,
        indicators,
        round,
      )

      // Bear rebuts Bull's argument
      const bearRebuttal = await this.rebut(
        'bear',
        this.bearLlm,
        report,
        currentBear,
        currentBull,
        indicators,
        round,
      )

      rounds.push({
        round,
        bullArgument: bullRebuttal,
        bearArgument: bearRebuttal,
      })

      currentBull = bullRebuttal
      currentBear = bearRebuttal
    }

    return {
      rounds,
      bullFinal: currentBull,
      bearFinal: currentBear,
    }
  }

  private async rebut(
    side: 'bull' | 'bear',
    llm: ILLMProvider,
    report: TradingReport,
    ownPrevious: Finding,
    opponentPrevious: Finding,
    indicators: string,
    round: number,
  ): Promise<Finding> {
    const sideName = side === 'bull' ? 'bullish' : 'bearish'
    const opponentSide = side === 'bull' ? 'bearish' : 'bullish'

    const prompt = withLanguage(`${tickerPreservationInstruction(report.ticker)}

You are a ${sideName} equity analyst in round ${round} of a structured debate about ${report.ticker}.

${indicators}

YOUR PREVIOUS ARGUMENT:
${JSON.stringify({ stance: ownPrevious.stance, evidence: ownPrevious.evidence, confidence: ownPrevious.confidence })}

OPPONENT'S (${opponentSide}) ARGUMENT TO COUNTER:
${JSON.stringify({ stance: opponentPrevious.stance, evidence: opponentPrevious.evidence, confidence: opponentPrevious.confidence })}

INSTRUCTIONS:
- Directly address and counter the opponent's strongest points
- Strengthen your position with additional evidence from the data
- Adjust your confidence based on how strong the opponent's case is
- ALL evidence MUST cite specific numbers from the indicators above

Respond with ONLY a JSON object:
{
  "stance": "${side}",
  "evidence": ["<rebuttal point 1>", "<rebuttal point 2>", "..."],
  "confidence": <number 0-1, adjusted based on debate strength>
}`)

    try {
      const response = await llm.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: `Counter the ${opponentSide} argument for ${report.ticker}. Round ${round}. JSON only.` },
      ])

      const parsed = parseJson<Partial<Finding>>(response)
      return {
        agentName: `${side}Researcher_r${round}`,
        stance: side,
        evidence: parsed.evidence ?? ownPrevious.evidence,
        confidence: Math.min(1, Math.max(0, parsed.confidence ?? ownPrevious.confidence)),
        sentiment: parsed.sentiment,
        keyMetrics: parsed.keyMetrics,
      }
    } catch (err) {
      log.warn({ side, round, error: err instanceof Error ? err.message : String(err) }, 'Rebuttal failed, keeping previous argument')
      return ownPrevious
    }
  }
}
