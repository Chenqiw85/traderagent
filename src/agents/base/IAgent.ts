// src/agents/base/IAgent.ts

import type { AgentRole, TradingReport } from './types.js'

export interface IAgent {
  readonly name: string
  readonly role: AgentRole
  run(report: TradingReport): Promise<TradingReport>
}
