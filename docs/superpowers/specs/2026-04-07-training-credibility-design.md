# Training Credibility And Lesson Traceability — Design Spec

**Date:** 2026-04-07
**Status:** Approved

## Overview

Strengthen the existing `trader:train` workflow so it becomes the project's primary credibility engine. The goal is not to add more agents or more prompts. The goal is to make historical performance easier to trust and make lesson usage measurable instead of implicit.

This design keeps the current live-analysis pipeline intact and improves the training path in four ways:

- Expand decision scoring from a single composite number into a small, interpretable scorecard.
- Make lesson storage and retrieval deterministic across BM25 and Qdrant modes.
- Record lesson retrieval events during replay so later reports can show when lessons were actually used.
- Upgrade the training markdown output into a credibility report instead of a raw pass log.

## Problem Statement

The current repo already has the right building blocks:

- historical replay via `TraderAgent` and `Backtester`
- decision scoring via `CompositeScorer`
- lesson generation via `LessonExtractor` and `ReflectionEngine`
- lesson storage via `LessonsJournal`
- lesson retrieval during normal analysis via researchers and manager

The current trust gaps are:

1. `trader:train` produces a single blended score, which is too compressed to justify trust by itself.
2. The 5-tier action model is only partially represented in evaluation. Broad bullish vs bearish correctness is measured better than exact tier quality.
3. Confidence is emitted everywhere, but the training output does not clearly show whether confidence is calibrated over time.
4. Lessons are stored, but the system cannot prove which decisions retrieved them or whether retrieval is associated with better outcomes.
5. In BM25 memory mode, training writes lessons to the shared store while some agents retrieve from per-agent stores, so lessons can exist but still be invisible to later analysis.

## Goals

- Make `npm run trader:train -- <TICKER> [MARKET] ...` the main empirical credibility command.
- Preserve the current live `run:analyze` behavior.
- Keep the existing replay/orchestrator architecture instead of building a second backtest pipeline.
- Show a small set of credibility metrics that a human can understand quickly.
- Make lesson retrieval auditable for both training replays and later live analysis.

## Non-Goals

- No change to the core live decision flow in `run:analyze`.
- No new database schema in this phase.
- No claim of causal lesson effectiveness; the report will show association, not proof of causation.
- No fully general benchmark suite with baseline strategies and CI regression gates in this phase.

## Architecture

The existing training flow remains:

`Backtester -> per-decision scoring -> lesson extraction/reflection -> lesson storage -> next pass replay`

This design adds three components around it:

### 1. Decision Scorecard

The existing `CompositeScorer` becomes the project's per-decision scorecard. It remains the place where replayed decisions are judged, but it now outputs a richer structure instead of only the current four values plus one composite score.

Responsibilities:

- map continuous price outcomes into 5-tier realized outcomes
- compute exact-tier and distance-aware action quality
- retain broad directional quality
- retain confidence calibration scoring
- retain hold-quality and risk-execution scoring
- produce a single `compositeScore` for coarse ranking, while exposing all sub-metrics separately

### 2. Lesson Trace

Every training replay should be able to answer:

- which lessons were stored
- which agent retrieved them later
- which decision date they were retrieved for
- how often a lesson was retrieved
- whether retrieval is associated with better or worse downstream scores

This requires lesson retrieval to be recorded as structured trace data, not only injected into prompts as invisible context.

### 3. Training Credibility Report

The training markdown report becomes the human-facing evidence layer. It should summarize performance, calibration, and lesson usage in language that is interpretable without reading code.

## Data Flow

### Replay Flow

For each replay date in `Backtester.replay()`:

1. Build the date-filtered orchestrator as today.
2. Run the full pipeline for the historical `asOf` date.
3. During agent execution, record any lesson retrieval events on the report.
4. After the final decision is produced, compute the richer scorecard from the decision and realized outcome window.
5. Attach lesson retrieval summaries to the resulting `ScoredDecision`.

### Pass Flow

For each training pass:

1. Replay the train window and collect scored decisions plus lesson retrieval traces.
2. Extract lessons and reflections from the train window as today.
3. Store those lessons in the lesson system with deterministic metadata.
4. Replay the test window with retrieval tracing enabled.
5. Aggregate credibility metrics from train and test decisions.
6. Emit both the per-pass summary and final credibility report.

## Scoring Model

The project should keep `compositeScore`, but it must stop being the only headline metric. The report should expose a scorecard with explicit sub-metrics.

### Realized Tier Mapping

Map realized return over the evaluation window to an outcome tier using explicit thresholds:

- `BUY` if return is greater than or equal to `+0.05`
- `OVERWEIGHT` if return is greater than or equal to `+0.02` and less than `+0.05`
- `HOLD` if absolute return is less than `0.02`
- `UNDERWEIGHT` if return is less than or equal to `-0.02` and greater than `-0.05`
- `SELL` if return is less than or equal to `-0.05`

These thresholds should be configurable later, but the first implementation should keep them local to training so the behavior is explicit and testable.

### Per-Decision Metrics

The scorecard should expose at least these fields:

```ts
type DecisionScoreBreakdown = {
  tierDistanceScore: number
  exactTierHit: boolean
  directionalScore: number
  calibrationScore: number
  holdQualityScore: number
  riskExecutionScore: number
}
```

Definitions:

- `tierDistanceScore`
  Score based on how far the chosen tier is from the realized tier on the 5-tier ladder.
  Exact match = `1.0`.
  One tier away = `0.75`.
  Two tiers away = `0.5`.
  Three tiers away = `0.25`.
  Four tiers away = `0.0`.

- `exactTierHit`
  Boolean used for reporting exact-tier hit rate.

- `directionalScore`
  Keep the current broad bullish/bearish correctness behavior because it is still a useful coarse metric.

- `calibrationScore`
  Keep the current per-decision intuition:
  correct and confident = high score, wrong and confident = low score.

- `holdQualityScore`
  Reward `HOLD` only when realized movement stayed inside the configured hold threshold.

- `riskExecutionScore`
  Keep the current take-profit / stop-loss evaluation, but name it explicitly as a risk-management measure rather than folding it into a generic target metric.

### Composite Score

Keep a single blended score for ranking and early stopping, but compute it from the richer sub-metrics:

```ts
const SCORE_WEIGHTS = {
  tierDistance: 0.3,
  directional: 0.2,
  calibration: 0.2,
  holdQuality: 0.1,
  riskExecution: 0.2,
}
```

This preserves a single optimization number while making the report explain what that number means.

## Credibility Metrics

The pass-level and final report should show:

- exact-tier hit rate
- directional hit rate
- average composite score
- confidence calibration error by bucket
- high-confidence miss count
- action distribution by tier
- score with lessons retrieved vs without lessons retrieved
- retrieval rate by agent
- lessons most associated with above-average outcomes
- lessons most associated with below-average outcomes

### Calibration Buckets

Use five buckets:

- `0.00-0.19`
- `0.20-0.39`
- `0.40-0.59`
- `0.60-0.79`
- `0.80-1.00`

For each bucket, report:

- decision count
- average predicted confidence
- empirical directional hit rate
- absolute calibration gap

If a bucket has fewer than three samples, mark it as low-sample in the report instead of over-interpreting it.

### High-Confidence Misses

A high-confidence miss is:

- confidence greater than or equal to `0.75`
- and either directional score is poor or tier distance score is below `0.5`

This gives the report a simple “why not trust this yet” signal.

## Lesson Storage And Retrieval Contract

The lesson system needs one source of truth.

### Storage Contract

All lessons should be written to the shared vector store namespace with consistent metadata:

```ts
type StoredLessonMetadata = {
  type: 'lesson'
  ticker: string
  market: string
  passNumber: number
  source: 'extractor' | 'reflection'
  perspective: 'bull' | 'bear' | 'manager' | 'shared'
  confidence: number
}
```

`perspective` should be metadata, not a separate store boundary.
The first implementation should store extracted and reflected lessons as `shared` unless a later change teaches the lesson generators to emit a narrower perspective explicitly.

### Retrieval Contract

Researchers and manager should retrieve lessons from the shared lesson store using:

- `ticker`
- `market`
- `type: 'lesson'`

They may prefer lessons matching their own `perspective`, but they should never depend on separate BM25 stores to access them.

This removes the current memory-mode inconsistency where training stores lessons in one place and later agents read from another.

### Trace Model

Every retrieval should produce a trace record:

```ts
type LessonRetrievalEvent = {
  lessonId: string
  agent: string
  perspective: 'bull' | 'bear' | 'manager' | 'shared'
  ticker: string
  market: string
  asOf: string
  query: string
  rank: number
}
```

Every replayed decision should also carry a summary:

```ts
type LessonUsageSummary = {
  retrievedCount: number
  retrievedByAgent: Record<string, number>
  topLessonIds: string[]
}
```

The report should use these traces for association analysis. It should not claim that a lesson caused an improvement, only that a lesson was retrieved on decisions that later scored above or below the pass average.

## Type And File Changes

### Modified Files

- `src/agents/base/types.ts`
  Add report-level lesson retrieval trace types and carry retrieval events on `TradingReport` so agents can append them during replay and live analysis.
- `src/agents/trader/types.ts`
  Expand scoring and credibility result types.
- `src/agents/trader/CompositeScorer.ts`
  Implement the richer decision scorecard and keep the composite output.
- `src/agents/trader/Backtester.ts`
  Carry retrieval summaries from the final report into `ScoredDecision`.
- `src/agents/trader/TraderAgent.ts`
  Aggregate pass-level credibility metrics and include them in pass results.
- `src/agents/trader/LessonsJournal.ts`
  Store the new lesson metadata shape and expose identifiers needed for retrieval tracing.
- `src/agents/researcher/BaseResearcher.ts`
  Record lesson retrieval events alongside prompt context construction.
- `src/agents/manager/Manager.ts`
  Record manager-side lesson retrieval events.
- `src/orchestrator/OrchestratorFactory.ts`
  Remove lesson retrieval dependence on per-agent BM25 stores.
- `src/reports/TrainerReport.ts`
  Add credibility summary, calibration tables, lesson-effectiveness sections, and overconfident miss summaries.

### New File

- `src/agents/trader/CredibilityAnalyzer.ts`
  Pure aggregation utilities that compute pass-level and final credibility metrics from `ScoredDecision[]`.

## Report Structure

The training report should keep the existing pass table, but add a top-level credibility summary.

Recommended structure:

1. `Configuration`
2. `Credibility Summary`
3. `Pass Results`
4. `Calibration`
5. `Lesson Effectiveness`
6. `Per-Pass Details`
7. `Why Trust / Why Not Trust`

### Credibility Summary

Show a concise summary such as:

`Pass 3 test: exact-tier 31%, directional 57%, calibration gap 0.12, lesson-assisted score +0.06, composite 0.64`

### Why Trust / Why Not Trust

End the report with a short human-readable summary:

- why the current system looks more credible than before
- where it is still weak
- which action tiers are most error-prone
- whether lessons appear to help, hurt, or remain inconclusive

## Error Handling

- If lesson retrieval is unavailable, training should continue and mark lesson metrics as unavailable rather than failing the whole pass.
- If no lessons are retrieved for a pass, the report should say so explicitly instead of showing blank comparisons.
- If a confidence bucket is under-sampled, report the count and skip strong conclusions.
- If a replayed decision has no stop-loss or take-profit, `riskExecutionScore` should be neutral rather than punitive.
- If malformed lesson metadata is encountered, skip the bad lesson and continue logging retrieval for the rest.

## Testing Strategy

The implementation should add tests in four layers.

### 1. Metric Correctness

Unit tests for:

- realized tier mapping thresholds
- tier distance scoring
- exact-tier hit behavior
- calibration scoring
- hold-quality scoring
- risk-execution scoring

### 2. Lesson Trace Correctness

Unit tests for:

- lesson metadata shape on storage
- retrieval from the shared store in BM25 mode
- retrieval trace creation in researchers and manager
- conversion from raw retrieval events into `LessonUsageSummary`

### 3. Report Correctness

Report tests for:

- credibility summary section
- calibration table formatting
- lesson-effectiveness table formatting
- low-sample bucket handling

### 4. Integration Behavior

End-to-end training tests proving:

- lessons are generated
- later replays can retrieve them
- retrieval traces are attached to scored decisions
- pass-level report data distinguishes decisions with lessons from decisions without lessons

## Rollout Order

Implement in this order:

1. unify lesson storage and retrieval contract
2. expand per-decision scorecard and types
3. attach retrieval traces to replay results
4. add pass-level credibility aggregation
5. upgrade markdown report output
6. add tests across scorer, retrieval, and reporting

This order matters. Otherwise the project risks producing polished credibility numbers on top of unreliable lesson retrieval.

## Success Criteria

- `trader:train` reports exact-tier, directional, calibration, and lesson-usage metrics in a single markdown report.
- BM25 memory mode and Qdrant mode both retrieve lessons from the same logical lesson namespace.
- A scored decision can show whether lessons were retrieved and by which agent.
- The final report can distinguish “lessons retrieved” from “no lessons retrieved” outcomes without claiming causation.
- The implementation requires no new database schema and does not change the existing `run:analyze` command semantics.
