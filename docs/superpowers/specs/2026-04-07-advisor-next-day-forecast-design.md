# Advisor Next-Day Forecast Quality — Design Spec

**Date:** 2026-04-07
**Status:** Approved

## Overview

Improve the advisor pipeline so it is optimized for next-trading-day directional calls, not just lightweight daily commentary. The new advisor should make a per-ticker next-day forecast from a hard reference price while reusing the richer structured output already produced by `npm run run:analyze`.

The design replaces the current advisor's stale-report delta update model with a two-layer model:

- a baseline layer from the latest full `run:analyze` snapshot
- a fresh daily overlay from current price, technical, news, and index data

The advisor then produces a dedicated next-day forecast object per ticker, separate from the underlying long-horizon analysis recommendation.

## Problem Statement

The current advisor quality ceiling comes from its architecture:

1. It does not run a fresh full analysis per ticker for the daily advisory path.
2. It relies on `DailyUpdateAnalyzer` to adjust the previous report from short-term deltas instead of rebuilding the thesis from stronger evidence.
3. It has no explicit next-day forecast contract with a hard reference price.
4. It does not distinguish between an old trade-planning entry level and a next-session forecast anchor.
5. It does not persist a clean evaluation target for measuring next-day forecasting quality over time.

This creates the wrong optimization target for the user's goal, which is better daily trend prediction quality with a concrete reference price.

## Goals

- Make the advisor optimize for next-trading-day direction per ticker.
- Use a hard `referencePrice` as the forecast anchor for scoring.
- Reuse the stronger `run:analyze` outputs instead of keeping a weak advisor-only mini-pipeline.
- Refresh only time-sensitive inputs daily.
- Keep fundamentals as reusable baseline context unless missing, stale, or catalyst-sensitive.
- Add explicit evaluation for next-day forecast quality.

## Non-Goals

- Do not replace or degrade the existing `run:analyze` pipeline.
- Do not make fundamentals mandatory to refetch on every advisor run.
- Do not treat markdown report parsing as the primary machine-readable source when the structured DB snapshot exists.
- Do not emit a normal forecast when same-day price data is unavailable.
- Do not collapse the advisor into only the generic `finalDecision` from the live pipeline.

## Design Decisions

- **Approach A (approved): full-analysis baseline plus fresh daily overlay**
  The advisor should use the latest completed full-analysis snapshot as its baseline context and merge it with same-day market inputs before making a next-day forecast.

- **Baseline source preference**
  Prefer `AnalysisRun.snapshot` from the database because it preserves the structured `TradingReport`.
  Use markdown parsing only as fallback.

- **Freshness split**
  Reuse slow-moving context from the baseline report and refresh fast-moving context daily.

- **Forecast contract**
  The advisor must emit a dedicated next-day forecast object with a hard `referencePrice`, rather than only exposing the older `finalDecision`.

- **Scoring contract**
  The forecast is judged against the next session's movement from the emitted `referencePrice`.

## Architecture

Per ticker, the improved advisor should execute this logical flow:

1. Load the latest completed full-analysis snapshot for the ticker.
2. If the snapshot is missing or stale, run a fresh full orchestrator analysis and persist its result as the new baseline.
3. Fetch fresh daily inputs needed for tomorrow's call:
   - latest OHLCV bars
   - recent news
   - market-index state
   - recomputed technical indicators from fresh bars
4. Merge baseline context plus fresh overlay into an advisor-specific next-day forecast input.
5. Produce a next-day forecast object anchored to a hard `referencePrice`.
6. Build the advisor report from:
   - market trend analysis
   - per-ticker next-day forecasts
   - the underlying baseline live-analysis recommendation

The key boundary is:

- the `Orchestrator` remains the source of rich full analysis
- the advisor forecasting layer becomes the source of tomorrow's directional call

## Data Sources And Inputs

### Baseline Context

The advisor should reuse these structured fields from the latest full `run:analyze` result when available:

- `computedIndicators`
- `researchThesis`
- `traderProposal`
- `riskAssessment`
- `riskVerdict`
- `finalDecision`

Preferred source:

- `AnalysisRun.snapshot` via the existing persisted structured report

Fallback source:

- markdown report parsing

Markdown fallback is acceptable for continuity, but it is less reliable than the structured snapshot path because it reconstructs data from rendered text.

### Fresh Daily Overlay

The advisor should refresh the following inputs every daily run:

- latest ticker OHLCV bars
- recent ticker news
- current market-index state
- recomputed technical indicators from the latest bars

These are the fast-moving inputs that determine whether tomorrow's expected move still aligns with the baseline thesis.

### Fundamentals Policy

Fundamentals should usually come from the baseline full-analysis report, not from mandatory daily refetching.

Refetch fundamentals only when:

- the baseline snapshot has no fundamentals
- the baseline snapshot is stale enough that the full run is being refreshed anyway
- a material catalyst is known, such as earnings

This keeps the advisor grounded in richer context without wasting daily work on low-frequency data that usually does not change enough to affect tomorrow's call.

## Freshness And Staleness Rules

Recommended baseline freshness rule:

- if the latest completed full-analysis snapshot is older than `3 trading days`, treat it as stale

Behavior:

- if baseline is missing: run a fresh full analysis first
- if baseline is stale: run a fresh full analysis first
- if baseline is recent: reuse it and apply a fresh daily overlay

If a stale baseline cannot be refreshed because the full analysis fails, the advisor should not silently continue as if the data is current. A stale baseline is not a valid baseline for a normal next-day forecast. Confidence reduction is only for partial-data situations where the baseline is still fresh enough but some non-critical overlay input is missing.

## Forecast Contract

Each ticker advisory should include a dedicated next-day forecast object, separate from the underlying live-analysis decision.

Recommended shape:

```ts
type NextDayForecast = {
  predictedDirection: 'up' | 'down' | 'flat'
  referencePrice: number
  targetSession: string
  confidence: number
  reasoning: string
  baselineAction: 'BUY' | 'OVERWEIGHT' | 'HOLD' | 'UNDERWEIGHT' | 'SELL'
  baselineReferencePrice?: number
  changeFromBaseline: 'strengthened' | 'weakened' | 'reversed' | 'unchanged'
}
```

### Reference Price Meaning

The advisor's `referencePrice` is a hard prediction anchor.

It is not the same concept as an older `traderProposal.referencePrice`, which is often an entry level from the baseline analysis.

Rules:

- use the latest completed market price available for the current session as the default next-day forecast anchor
- keep `traderProposal.referencePrice` as baseline context when available
- do not automatically reuse the old proposal reference price as tomorrow's scoring anchor

This preserves the user's requested meaning:

- the forecast is evaluated from the exact price emitted by the advisor

### Confidence Rules

Confidence must be capped by evidence quality.

Examples:

- cap confidence if baseline is stale or partially degraded
- cap confidence if fresh news is unavailable
- cap confidence if fresh overlay sharply conflicts with the baseline thesis
- reserve high confidence for cases where baseline thesis, fresh technicals, and market regime all align

The advisor should be harder to push into high confidence than the generic live decision path because next-day forecasting is a narrower and noisier problem.

## Reporting Contract

The advisor report should show both:

- the dedicated next-day forecast
- the underlying baseline live-analysis recommendation

This gives the user two separate views:

- tomorrow's directional call
- the deeper full-analysis thesis and action bias

Per ticker, the report should surface:

- forecast direction
- forecast reference price
- target session
- forecast confidence
- short next-day reasoning
- baseline action
- baseline proposal reference price when present
- whether the fresh overlay strengthened, weakened, reversed, or left unchanged the baseline view

## Error Handling

The improved advisor should fail selectively instead of guessing.

### Hard blockers

Do not emit a normal next-day forecast if:

- there is no usable baseline and the refresh full run fails
- the only available baseline is stale and the refresh full run fails
- fresh OHLCV for the current session is unavailable

These failures break the reliability of the same-day forecast anchor.

### Soft degradations

Continue with reduced confidence if:

- fundamentals are missing but the baseline thesis is otherwise usable
- fresh news is unavailable
- some non-critical context is missing but same-day market pricing is intact

### Divergence handling

If the fresh overlay strongly contradicts the baseline thesis:

- keep the forecast if the fresh data is sufficient
- explicitly label the forecast as a divergence from baseline
- reduce confidence unless the fresh evidence is unusually strong

## Evaluation And Quality Measurement

Improving advisor quality requires explicit scoring for the next-day forecast path.

The repo should add a next-day forecast evaluator that scores each emitted forecast after the target session completes.

Recommended metrics:

- directional hit rate from `referencePrice` to next session close
- flat-call precision when predicted movement is too small to matter
- confidence calibration by bucket
- average signed return from following the forecast direction
- results split by confidence bucket
- divergence cases: whether reversing the baseline was helpful or harmful

### Forecast Persistence

The advisor should persist enough structured forecast data to score later:

- ticker
- market
- issue timestamp
- target session
- predicted direction
- reference price
- confidence
- baseline action
- change-from-baseline classification

The evaluation loop becomes:

`forecast today -> observe next session -> score -> compare prompt/model/policy changes later`

Without this loop, the project can improve advisor wording without improving next-day prediction quality.

## Expected Code Impact

This design implies the following code-level changes in a later implementation phase:

- replace or bypass the current `DailyUpdateAnalyzer`-centered advisor path
- add a loader that prefers structured `AnalysisRun.snapshot` baseline context
- add freshness and refresh policy around full-analysis baselines
- add an advisor-specific forecasting component for next-day calls
- extend advisor report types and formatting to include the next-day forecast object
- add structured persistence and evaluation for next-day forecasts

## Summary

The improved advisor should stop behaving like a light commentary layer over yesterday's thesis. It should become a next-day forecasting layer built on top of the strongest evidence the repo already knows how to generate.

The approved direction is:

- use the latest full `run:analyze` report as the baseline
- refresh only fast-moving same-day inputs
- emit a separate next-day forecast object with a hard reference price
- score quality against the next session from that exact anchor

This is the smallest architecture change that directly targets the user's stated goal: better daily trend prediction quality with a concrete, testable reference price.
