# Analysis Markdown Retention Simplification

**Date:** 2026-04-08
**Status:** Approved
**Approach:** Stable Per-Ticker Markdown File With Legacy Fallback

## Overview

Simplify analyze-pipeline markdown retention so each ticker-market pair keeps a single current markdown file instead of accumulating timestamped files.

This change applies only to analyze-pipeline markdown output. PostgreSQL persistence remains append-only for now, so `AnalysisRun` and `AnalysisStage` continue to preserve execution history for advisor baselines, debugging, and auditability.

## Problem Statement

The current analyze pipeline writes reports like `reports/BNO_US_2026-04-08_2339.md`. Repeated runs for the same ticker create a pile of nearly duplicate markdown files even though most downstream logic only needs the latest report.

This creates three practical issues:

1. Human-facing report browsing becomes noisy because one ticker can produce many near-identical files.
2. Markdown lookup logic is more complex than necessary because it must scan, sort, and parse filenames to find the latest report.
3. File retention and report replacement semantics differ from the user's desired model, where the latest analyze report should replace the previous one.

## Goals

- Keep exactly one current markdown report per `ticker + market` for analyze runs.
- Preserve current PostgreSQL behavior and schema.
- Keep existing advisor/report-loading behavior working during rollout.
- Support previously generated timestamped markdown reports as a fallback.
- Make the current markdown report filename easy to predict and open manually.

## Non-Goals

- No change to `AnalysisRun` or `AnalysisStage` retention in PostgreSQL.
- No deletion or migration of existing DB rows in this phase.
- No change to advisor markdown files such as `reports/advisor_2026-04-08_0211.md`.
- No change to training report filenames in this phase.
- No bulk cleanup of old timestamped analyze markdown files in this phase.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New analyze markdown filename | `reports/<TICKER>_<MARKET>.md` | Stable, readable, and directly keyed by report identity |
| Old timestamped files | Read-only legacy fallback | Avoids forced migration and keeps existing data usable |
| Source of `asOf` for stable file | Parse report body date line | Stable filenames no longer carry timestamp metadata |
| DB behavior | Unchanged | DB remains the source of history while markdown becomes the simple current view |

## Architecture

### 1. Analyze Markdown Writer

The analyze pipeline currently calls `saveAnalysisReport(report)` after each run. That write path should switch from timestamped filenames to a stable filename derived only from ticker and market.

Current behavior:

- `reports/BNO_US_2026-04-08_2339.md`

New behavior:

- `reports/BNO_US.md`

If a file already exists, the new report overwrites it.

### 2. ReportLoader Lookup Order

`ReportLoader` should change its markdown loading flow to prefer the stable file first and fall back to legacy timestamped files only when needed.

New lookup order:

1. Try `reports/<TICKER>_<MARKET>.md`
2. If missing or unreadable, scan legacy timestamped files matching `reports/<TICKER>_<MARKET>_YYYY-MM-DD_HHMM.md`
3. Return `null` only if neither source yields a usable report

This keeps rollout safe because previously generated files remain usable until each ticker is rerun and rewritten into the stable form.

### 3. Report Timestamp Parsing

The stable markdown filename no longer encodes `asOf`, so markdown-derived baselines need a body-level timestamp source.

The analysis markdown already renders a line in this form:

- `**Date:** YYYY-MM-DD HH:mm UTC`

`ReportLoader` should parse this line from markdown content when reading the stable file and convert it into a UTC `Date`.

Legacy timestamped files should keep their existing filename-based timestamp parsing because that logic already works and avoids unnecessary behavior changes for old reports.

## Data Flow

### Analyze Run

1. `run.ts` executes the pipeline and receives a `TradingReport`.
2. `saveAnalysisReport(report)` renders markdown as today.
3. The markdown writer saves to `reports/<ticker>_<market>.md`.
4. Any previous stable report for that ticker-market pair is replaced.

### Markdown Baseline Load

1. `ReportLoader.loadLatest(ticker, market)` checks DB first as today.
2. If DB is unavailable or unusable, it tries `reports/<ticker>_<market>.md`.
3. If the stable file exists, it parses `**Date:** ... UTC` from the body and returns that as `asOf`.
4. If the stable file is absent or invalid, it falls back to the legacy timestamped-file scan.

## Error Handling

- If the stable markdown file exists but has no parseable `**Date:**` line, treat it as unusable and continue to legacy fallback.
- If the stable markdown file is unreadable, log a warning and continue to legacy fallback.
- If both stable and legacy markdown sources fail, return `null` exactly as today.
- Do not silently invent `asOf` from filesystem metadata because report timestamps should remain derived from explicit report content.

## Testing

Add or update tests for:

- stable analyze markdown filenames in the report writer
- stable markdown load path in `ReportLoader`
- `asOf` parsing from `**Date:** YYYY-MM-DD HH:mm UTC`
- fallback from invalid stable markdown to valid legacy timestamped markdown
- continued support for legacy timestamped markdown parsing

## Migration Strategy

No one-time migration is required.

Rollout behavior:

1. Existing timestamped markdown reports remain on disk.
2. The next analyze run for a ticker writes `reports/<TICKER>_<MARKET>.md`.
3. From that point onward, markdown lookup for that ticker should resolve to the stable file first.

Old timestamped files can be cleaned up later with a separate maintenance task if desired.

## Risks And Trade-Offs

- Markdown history is no longer preserved for analyze runs once a ticker is rerun into the stable-file format.
- This is acceptable in this phase because DB history remains intact.
- The fallback path adds a small amount of compatibility complexity, but it keeps rollout low-risk and avoids immediate file cleanup work.

## Acceptance Criteria

- Running `npm run run:analyze -- BNO US` writes or overwrites `reports/BNO_US.md`.
- Running the same command again does not create a second timestamped analyze markdown file.
- `ReportLoader` can load the latest stable markdown report and recover the correct `asOf` timestamp from the report body.
- If no stable file exists, `ReportLoader` can still load a valid legacy timestamped markdown report.
- PostgreSQL `AnalysisRun` and `AnalysisStage` behavior remains unchanged.
