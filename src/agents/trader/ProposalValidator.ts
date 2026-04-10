import type { TraderProposal, ResearchThesis, ActionTier } from '../base/types.js'
import type { ProposalValidation } from '../../types/quality.js'

const BULL_ACTIONS: ActionTier[] = ['BUY', 'OVERWEIGHT']
const BEAR_ACTIONS: ActionTier[] = ['SELL', 'UNDERWEIGHT']
const LONG_ACTIONS: ActionTier[] = ['BUY', 'OVERWEIGHT']
const SHORT_ACTIONS: ActionTier[] = ['SELL', 'UNDERWEIGHT']

export class ProposalValidator {
  validate(proposal: TraderProposal, thesis: ResearchThesis): ProposalValidation {
    const violations: string[] = []

    const directionAligned = this.checkDirection(proposal.action, thesis.stance, violations)
    const isHold = proposal.action === 'HOLD'
    const hasPrices =
      proposal.referencePrice != null && proposal.stopLoss != null && proposal.takeProfit != null

    if (!isHold && !hasPrices) {
      violations.push('directional proposal missing executable price levels (referencePrice, stopLoss, takeProfit)')
    }

    const rrRatioValid = isHold || !hasPrices || this.checkRR(proposal, violations)
    const priceSane = isHold || !hasPrices || this.checkPriceSanity(proposal, violations)
    const confidenceConsistent = this.checkConfidence(
      proposal.confidence,
      thesis.confidence,
      violations,
    )

    const computedRR =
      hasPrices && !isHold
        ? this.computeRR(proposal.referencePrice!, proposal.stopLoss!, proposal.takeProfit!)
        : null

    const pricesPresent = isHold || hasPrices
    const valid = directionAligned && pricesPresent && rrRatioValid && priceSane && confidenceConsistent

    return {
      valid,
      directionAligned,
      rrRatioValid,
      priceSane,
      confidenceConsistent,
      computedRR,
      violations: Object.freeze(violations),
    }
  }

  private checkDirection(
    action: ActionTier,
    stance: ResearchThesis['stance'],
    violations: string[],
  ): boolean {
    if (stance === 'bull' && !BULL_ACTIONS.includes(action) && action !== 'HOLD') {
      violations.push(`direction mismatch: thesis is bull but action is ${action}`)
      return false
    }
    if (stance === 'bear' && !BEAR_ACTIONS.includes(action) && action !== 'HOLD') {
      violations.push(`direction mismatch: thesis is bear but action is ${action}`)
      return false
    }
    if (stance === 'neutral' && action !== 'HOLD') {
      violations.push(
        `direction mismatch: thesis is neutral but action is ${action}, expected HOLD`,
      )
      return false
    }
    return true
  }

  private checkRR(proposal: TraderProposal, violations: string[]): boolean {
    const rr = this.computeRR(
      proposal.referencePrice!,
      proposal.stopLoss!,
      proposal.takeProfit!,
    )
    if (rr < 2.0) {
      violations.push(`R:R ratio is ${rr.toFixed(2)}:1, minimum required is 2:1`)
      return false
    }
    return true
  }

  private computeRR(entry: number, stop: number, target: number): number {
    const risk = Math.abs(entry - stop)
    if (risk === 0) return 0
    const reward = Math.abs(target - entry)
    return reward / risk
  }

  private checkPriceSanity(proposal: TraderProposal, violations: string[]): boolean {
    const { referencePrice, stopLoss, takeProfit, action } = proposal
    if (referencePrice == null || stopLoss == null || takeProfit == null) return true

    if (LONG_ACTIONS.includes(action)) {
      if (stopLoss >= referencePrice) {
        violations.push(
          `price sanity: stop loss (${stopLoss}) must be below entry (${referencePrice}) for long`,
        )
        return false
      }
      if (takeProfit <= referencePrice) {
        violations.push(
          `price sanity: take profit (${takeProfit}) must be above entry (${referencePrice}) for long`,
        )
        return false
      }
    }

    if (SHORT_ACTIONS.includes(action)) {
      if (stopLoss <= referencePrice) {
        violations.push(
          `price sanity: stop loss (${stopLoss}) must be above entry (${referencePrice}) for short`,
        )
        return false
      }
      if (takeProfit >= referencePrice) {
        violations.push(
          `price sanity: take profit (${takeProfit}) must be below entry (${referencePrice}) for short`,
        )
        return false
      }
    }

    return true
  }

  private checkConfidence(
    proposalConfidence: number,
    thesisConfidence: number,
    violations: string[],
  ): boolean {
    if (proposalConfidence > thesisConfidence) {
      violations.push(
        `confidence inconsistency: proposal (${proposalConfidence}) exceeds thesis (${thesisConfidence})`,
      )
      return false
    }
    return true
  }
}
