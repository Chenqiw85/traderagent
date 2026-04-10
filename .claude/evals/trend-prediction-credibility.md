## EVAL: trend-prediction-credibility
Created: 2026-04-10

Evaluates whether this system qualifies as a credible trend-prediction system
across 7 dimensions of prediction credibility.

### Capability Evals

#### A. Data Foundation
- [ ] A1: Uses 2+ independent market data sources with fallback chains
- [ ] A2: Covers OHLCV, fundamentals, news, and technical indicators
- [ ] A3: Data freshness enforcement (staleness checks, caching with TTL)
- [ ] A4: Data quality assessment pipeline exists and runs automatically

#### B. Prediction Methodology
- [ ] B1: Generates explicit directional predictions (up/down/flat) with confidence scores
- [ ] B2: Uses multiple analytical perspectives (bull/bear/neutral)
- [ ] B3: Adversarial debate mechanism to stress-test predictions
- [ ] B4: Signal alignment scoring anchors LLM confidence to computed indicators
- [ ] B5: Predictions include actionable price targets (entry, stop-loss, take-profit)

#### C. Evaluation & Accuracy Tracking
- [ ] C1: Backtesting infrastructure exists with look-ahead bias prevention
- [ ] C2: Multi-dimensional scoring (directional, calibration, risk execution, tier accuracy)
- [ ] C3: Next-day forecast evaluator with hit rate and calibration metrics
- [ ] C4: Credibility analyzer tracks per-confidence-bucket performance
- [ ] C5: Historical forecasts are persisted for retrospective accuracy measurement

#### D. Risk Management
- [ ] D1: Pre-computed risk metrics (VaR, Beta, MaxDrawdown, Volatility)
- [ ] D2: Multi-perspective risk analysis (aggressive/conservative/neutral)
- [ ] D3: Proposal validation checks R:R ratio, direction alignment, price sanity
- [ ] D4: Risk verdict gate (approve/block) before final decision

#### E. Learning & Adaptation
- [ ] E1: Reflection engine analyzes worst-performing decisions
- [ ] E2: Lesson extraction stores patterns for future retrieval
- [ ] E3: Multi-pass training with iterative improvement
- [ ] E4: Lessons are retrieved and injected into future analyses via RAG

#### F. Quality Assurance Pipeline
- [ ] F1: Evidence validator filters ungrounded research claims
- [ ] F2: Conflict detector identifies bull/bear metric contradictions
- [ ] F3: Conflict resolver uses computed indicators to arbitrate
- [ ] F4: Fundamentals scorer provides quantitative (not just LLM-based) assessment

#### G. Production Readiness for Prediction
- [ ] G1: All tests pass (build + type check + test suite)
- [ ] G2: Prediction output is structured and machine-readable
- [ ] G3: Forecast persistence allows accuracy tracking over time
- [ ] G4: Concurrency control prevents API stampeding

### Regression Evals
- [ ] R1: Existing test suite passes (498 tests)
- [ ] R2: TypeScript type check passes with zero errors
- [ ] R3: No hardcoded secrets in source code

### Success Criteria
- pass@3 > 90% for capability evals
- pass^3 = 100% for regression evals
