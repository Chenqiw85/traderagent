// src/agents/risk/RiskDebateEngine.ts

import type { IAgent } from '../base/IAgent.js'
import type { TradingReport } from '../base/types.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('risk-debate-engine')

type RiskDebateEngineConfig = {
  aggressive: IAgent
  conservative: IAgent
  neutral: IAgent
  maxRounds: number
}

/**
 * Runs a multi-round 3-way debate between Aggressive, Conservative, and
 * Neutral risk analysts.  Each round, each analyst sees the others'
 * previous-round arguments (carried via analysisArtifacts) and responds.
 *
 * Returns the final TradingReport with all three analysts' artifacts
 * accumulated across rounds.
 */
export class RiskDebateEngine {
  private readonly aggressive: IAgent
  private readonly conservative: IAgent
  private readonly neutral: IAgent
  private readonly maxRounds: number

  constructor(config: RiskDebateEngineConfig) {
    this.aggressive = config.aggressive
    this.conservative = config.conservative
    this.neutral = config.neutral
    this.maxRounds = config.maxRounds
  }

  async debate(report: TradingReport): Promise<TradingReport> {
    let current = { ...report }

    for (let round = 1; round <= this.maxRounds; round++) {
      log.info({ ticker: report.ticker, round, maxRounds: this.maxRounds }, 'Starting risk debate round')

      // Each analyst runs sequentially so it can see the others' latest artifacts.
      // Order: Aggressive → Conservative → Neutral (same as TradingAgents reference).
      current = await this.aggressive.run(current)
      current = await this.conservative.run(current)
      current = await this.neutral.run(current)
    }

    return current
  }
}
