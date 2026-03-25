# Agents & Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 7 trading agents, the Orchestrator that wires them into a parallel pipeline, and 3 evaluators that score the platform's predictions.

**Architecture:** Each researcher agent extends a shared `BaseResearcher` that handles RAG retrieval and JSON parsing. Risk agents and the Manager operate purely on the `TradingReport` without RAG. The `Orchestrator` runs the researcher team in parallel, the risk team sequentially (since `RiskManager` depends on `RiskAnalyst`'s output), then the Manager. Evaluators are standalone classes that measure reasoning quality, directional accuracy, and aggregate backtest performance.

**Tech Stack:** TypeScript 5.4 ESM, Vitest, existing `ILLMProvider` / `IVectorStore` / `Embedder` / `TradingReport` interfaces from Plans 1 & 2.

---

## File Structure

**New source files:**
```
src/utils/parseJson.ts                       — strips markdown fences, calls JSON.parse
src/agents/researcher/BaseResearcher.ts      — abstract base: RAG retrieval + LLM call + JSON parse
src/agents/researcher/BullResearcher.ts      — extends BaseResearcher, bull stance
src/agents/researcher/BearResearcher.ts      — extends BaseResearcher, bear stance
src/agents/researcher/NewsAnalyst.ts         — extends BaseResearcher, sentiment + news
src/agents/researcher/FundamentalsAnalyst.ts — extends BaseResearcher, fundamentalScore + keyMetrics
src/agents/risk/RiskAnalyst.ts               — computes VaR, volatility, beta, maxDrawdown
src/agents/risk/RiskManager.ts               — sets maxPositionSize, stopLoss, takeProfit
src/agents/manager/Manager.ts               — reads full report, outputs BUY/SELL/HOLD Decision
src/orchestrator/Orchestrator.ts             — runs pipeline: fetch → researchers → risk → manager
src/evaluation/IEvaluator.ts                 — interface + EvaluationResult type
src/evaluation/ReasoningEvaluator.ts         — LLM-as-judge: scores logic, evidence, calibration
src/evaluation/AccuracyEvaluator.ts          — directional accuracy vs actual price return
src/evaluation/BacktestEvaluator.ts          — aggregate stats over historical entries
```

**New test files:**
```
tests/utils/parseJson.test.ts
tests/agents/researcher/bullResearcher.test.ts
tests/agents/researcher/bearResearcher.test.ts
tests/agents/researcher/newsAnalyst.test.ts
tests/agents/researcher/fundamentalsAnalyst.test.ts
tests/agents/risk/riskAnalyst.test.ts
tests/agents/risk/riskManager.test.ts
tests/agents/manager/manager.test.ts
tests/orchestrator/orchestrator.test.ts
tests/evaluation/reasoningEvaluator.test.ts
tests/evaluation/accuracyEvaluator.test.ts
tests/evaluation/backtestEvaluator.test.ts
```

---

## Task 1: JSON parsing utility

**Files:**
- Create: `src/utils/parseJson.ts`
- Create: `tests/utils/parseJson.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/utils/parseJson.test.ts
import { describe, it, expect } from 'vitest'
import { parseJson } from '../../src/utils/parseJson.js'

describe('parseJson', () => {
  it('parses a bare JSON object', () => {
    const result = parseJson<{ foo: string }>('{"foo":"bar"}')
    expect(result.foo).toBe('bar')
  })

  it('strips json markdown fences', () => {
    const result = parseJson<{ x: number }>('```json\n{"x": 42}\n```')
    expect(result.x).toBe(42)
  })

  it('strips plain code fences', () => {
    const result = parseJson<{ x: number }>('```\n{"x": 1}\n```')
    expect(result.x).toBe(1)
  })

  it('throws on invalid JSON', () => {
    expect(() => parseJson('not json')).toThrow()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/utils/parseJson.test.ts
```
Expected: FAIL — "Cannot find module '../../src/utils/parseJson.js'"

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/parseJson.ts

/**
 * Parse a JSON string from LLM output.
 * Strips markdown code fences (```json ... ``` or ``` ... ```) before parsing.
 */
export function parseJson<T>(text: string): T {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n/, '').replace(/\n?```\s*$/, '')
  }
  return JSON.parse(cleaned) as T
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- tests/utils/parseJson.test.ts
```
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/utils/parseJson.ts tests/utils/parseJson.test.ts
git commit -m "feat: add parseJson utility for LLM JSON response parsing"
```

---

## Task 2: BaseResearcher + BullResearcher

**Files:**
- Create: `src/agents/researcher/BaseResearcher.ts`
- Create: `src/agents/researcher/BullResearcher.ts`
- Create: `tests/agents/researcher/bullResearcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agents/researcher/bullResearcher.test.ts
import { describe, it, expect, vi } from 'vitest'
import { BullResearcher } from '../../../src/agents/researcher/BullResearcher.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { IVectorStore } from '../../../src/rag/IVectorStore.js'
import type { Embedder } from '../../../src/rag/embedder.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function mockVectorStore(): IVectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([{ id: '1', content: 'AAPL is undervalued', metadata: {} }]),
    delete: vi.fn(),
  }
}

function mockEmbedder(): Embedder {
  return {
    embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)),
    embedBatch: vi.fn(),
  } as unknown as Embedder
}

function emptyReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [],
  }
}

describe('BullResearcher', () => {
  it('has correct name and role', () => {
    const agent = new BullResearcher({ llm: mockLLM('{}') })
    expect(agent.name).toBe('bullResearcher')
    expect(agent.role).toBe('researcher')
  })

  it('appends a bull finding to researchFindings', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["Strong earnings growth"],"confidence":0.8}')
    const agent = new BullResearcher({ llm })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings).toHaveLength(1)
    expect(result.researchFindings[0].stance).toBe('bull')
    expect(result.researchFindings[0].agentName).toBe('bullResearcher')
    expect(result.researchFindings[0].confidence).toBe(0.8)
  })

  it('queries vector store when configured', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["test"],"confidence":0.7}')
    const vs = mockVectorStore()
    const embedder = mockEmbedder()
    const agent = new BullResearcher({ llm, vectorStore: vs, embedder })
    await agent.run(emptyReport())
    expect(embedder.embed).toHaveBeenCalled()
    expect(vs.search).toHaveBeenCalled()
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new BullResearcher({ llm: mockLLM('not valid json') })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings).toHaveLength(1)
    expect(result.researchFindings[0].stance).toBe('neutral')
    expect(result.researchFindings[0].confidence).toBe(0)
  })

  it('works without vector store configured', async () => {
    const llm = mockLLM('{"stance":"bull","evidence":["test"],"confidence":0.6}')
    const agent = new BullResearcher({ llm })
    const result = await agent.run(emptyReport())
    expect(llm.chat).toHaveBeenCalledOnce()
    expect(result.researchFindings).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/agents/researcher/bullResearcher.test.ts
```
Expected: FAIL — "Cannot find module '...BullResearcher.js'"

- [ ] **Step 3: Write BaseResearcher**

```ts
// src/agents/researcher/BaseResearcher.ts
import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, Finding, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import type { IVectorStore } from '../../rag/IVectorStore.js'
import type { Embedder } from '../../rag/embedder.js'
import { parseJson } from '../../utils/parseJson.js'

export type ResearcherConfig = {
  llm: ILLMProvider
  vectorStore?: IVectorStore
  embedder?: Embedder
  topK?: number
}

export abstract class BaseResearcher implements IAgent {
  abstract readonly name: string
  readonly role: AgentRole = 'researcher'

  protected llm: ILLMProvider
  protected vectorStore?: IVectorStore
  protected embedder?: Embedder
  protected topK: number

  constructor(config: ResearcherConfig) {
    this.llm = config.llm
    this.vectorStore = config.vectorStore
    this.embedder = config.embedder
    this.topK = config.topK ?? 5
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const context = await this.retrieveContext(report)
    const systemPrompt = this.buildSystemPrompt(report, context)
    const response = await this.llm.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analyze ${report.ticker} on the ${report.market} market. Respond with JSON only.` },
    ])
    const finding = this.parseFinding(response)
    return {
      ...report,
      researchFindings: [...report.researchFindings, finding],
    }
  }

  protected async retrieveContext(report: TradingReport): Promise<string> {
    if (!this.vectorStore || !this.embedder) return ''
    const query = this.buildQuery(report)
    const embedding = await this.embedder.embed(query)
    const docs = await this.vectorStore.search(embedding, this.topK, {
      must: [{ ticker: report.ticker }],
    })
    return docs.map((d) => d.content).join('\n\n')
  }

  protected parseFinding(response: string): Finding {
    try {
      const parsed = parseJson<Partial<Finding>>(response)
      return {
        agentName: this.name,
        stance: parsed.stance ?? 'neutral',
        evidence: parsed.evidence ?? [],
        confidence: parsed.confidence ?? 0.5,
        sentiment: parsed.sentiment,
        fundamentalScore: parsed.fundamentalScore,
        keyMetrics: parsed.keyMetrics,
      }
    } catch {
      return {
        agentName: this.name,
        stance: 'neutral',
        evidence: [`${this.name} was unable to parse LLM response`],
        confidence: 0,
      }
    }
  }

  protected abstract buildQuery(report: TradingReport): string
  protected abstract buildSystemPrompt(report: TradingReport, context: string): string
}
```

- [ ] **Step 4: Write BullResearcher**

```ts
// src/agents/researcher/BullResearcher.ts
import { BaseResearcher } from './BaseResearcher.js'
import type { TradingReport } from '../base/types.js'

export class BullResearcher extends BaseResearcher {
  readonly name = 'bullResearcher'

  protected buildQuery(report: TradingReport): string {
    return `bullish investment signals and buy evidence for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string): string {
    return `You are a bullish equity analyst. Find evidence that supports buying ${report.ticker}.
${context ? `\nRelevant market data:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bull",
  "evidence": ["<evidence point 1>", "<evidence point 2>"],
  "confidence": <number 0-1>
}`
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm test -- tests/agents/researcher/bullResearcher.test.ts
```
Expected: PASS — 5 tests

- [ ] **Step 6: Commit**

```bash
git add src/agents/researcher/BaseResearcher.ts src/agents/researcher/BullResearcher.ts tests/agents/researcher/bullResearcher.test.ts
git commit -m "feat: add BaseResearcher and BullResearcher agent"
```

---

## Task 3: BearResearcher

**Files:**
- Create: `src/agents/researcher/BearResearcher.ts`
- Create: `tests/agents/researcher/bearResearcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agents/researcher/bearResearcher.test.ts
import { describe, it, expect, vi } from 'vitest'
import { BearResearcher } from '../../../src/agents/researcher/BearResearcher.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function emptyReport(): TradingReport {
  return { ticker: 'AAPL', market: 'US', timestamp: new Date(), rawData: [], researchFindings: [] }
}

describe('BearResearcher', () => {
  it('has correct name and role', () => {
    const agent = new BearResearcher({ llm: mockLLM('{}') })
    expect(agent.name).toBe('bearResearcher')
    expect(agent.role).toBe('researcher')
  })

  it('appends a bear finding to researchFindings', async () => {
    const llm = mockLLM('{"stance":"bear","evidence":["Declining revenue"],"confidence":0.75}')
    const agent = new BearResearcher({ llm })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings).toHaveLength(1)
    expect(result.researchFindings[0].stance).toBe('bear')
    expect(result.researchFindings[0].agentName).toBe('bearResearcher')
    expect(result.researchFindings[0].confidence).toBe(0.75)
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new BearResearcher({ llm: mockLLM('not json') })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].stance).toBe('neutral')
    expect(result.researchFindings[0].confidence).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/agents/researcher/bearResearcher.test.ts
```
Expected: FAIL — "Cannot find module '...BearResearcher.js'"

- [ ] **Step 3: Write BearResearcher**

```ts
// src/agents/researcher/BearResearcher.ts
import { BaseResearcher } from './BaseResearcher.js'
import type { TradingReport } from '../base/types.js'

export class BearResearcher extends BaseResearcher {
  readonly name = 'bearResearcher'

  protected buildQuery(report: TradingReport): string {
    return `bearish investment signals and sell evidence for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string): string {
    return `You are a bearish equity analyst. Find evidence that supports selling or avoiding ${report.ticker}.
${context ? `\nRelevant market data:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bear",
  "evidence": ["<evidence point 1>", "<evidence point 2>"],
  "confidence": <number 0-1>
}`
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- tests/agents/researcher/bearResearcher.test.ts
```
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/agents/researcher/BearResearcher.ts tests/agents/researcher/bearResearcher.test.ts
git commit -m "feat: add BearResearcher agent"
```

---

## Task 4: NewsAnalyst

**Files:**
- Create: `src/agents/researcher/NewsAnalyst.ts`
- Create: `tests/agents/researcher/newsAnalyst.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agents/researcher/newsAnalyst.test.ts
import { describe, it, expect, vi } from 'vitest'
import { NewsAnalyst } from '../../../src/agents/researcher/NewsAnalyst.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function emptyReport(): TradingReport {
  return { ticker: 'AAPL', market: 'US', timestamp: new Date(), rawData: [], researchFindings: [] }
}

describe('NewsAnalyst', () => {
  it('has correct name and role', () => {
    const agent = new NewsAnalyst({ llm: mockLLM('{}') })
    expect(agent.name).toBe('newsAnalyst')
    expect(agent.role).toBe('researcher')
  })

  it('captures sentiment in the finding', async () => {
    const llm = mockLLM(
      '{"stance":"bull","sentiment":"broadly positive coverage","evidence":["CEO praised"],"confidence":0.6}'
    )
    const agent = new NewsAnalyst({ llm })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].sentiment).toBe('broadly positive coverage')
    expect(result.researchFindings[0].agentName).toBe('newsAnalyst')
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new NewsAnalyst({ llm: mockLLM('bad') })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].confidence).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/agents/researcher/newsAnalyst.test.ts
```
Expected: FAIL — "Cannot find module '...NewsAnalyst.js'"

- [ ] **Step 3: Write NewsAnalyst**

```ts
// src/agents/researcher/NewsAnalyst.ts
import { BaseResearcher } from './BaseResearcher.js'
import type { TradingReport } from '../base/types.js'

export class NewsAnalyst extends BaseResearcher {
  readonly name = 'newsAnalyst'

  protected buildQuery(report: TradingReport): string {
    return `recent news articles and market sentiment for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string): string {
    return `You are a financial news analyst. Analyze recent news and market sentiment for ${report.ticker}.
${context ? `\nRecent news:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bull" | "bear" | "neutral",
  "sentiment": "<overall sentiment description>",
  "evidence": ["<news point 1>", "<news point 2>"],
  "confidence": <number 0-1>
}`
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- tests/agents/researcher/newsAnalyst.test.ts
```
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/agents/researcher/NewsAnalyst.ts tests/agents/researcher/newsAnalyst.test.ts
git commit -m "feat: add NewsAnalyst agent"
```

---

## Task 5: FundamentalsAnalyst

**Files:**
- Create: `src/agents/researcher/FundamentalsAnalyst.ts`
- Create: `tests/agents/researcher/fundamentalsAnalyst.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agents/researcher/fundamentalsAnalyst.test.ts
import { describe, it, expect, vi } from 'vitest'
import { FundamentalsAnalyst } from '../../../src/agents/researcher/FundamentalsAnalyst.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function emptyReport(): TradingReport {
  return { ticker: 'AAPL', market: 'US', timestamp: new Date(), rawData: [], researchFindings: [] }
}

describe('FundamentalsAnalyst', () => {
  it('has correct name and role', () => {
    const agent = new FundamentalsAnalyst({ llm: mockLLM('{}') })
    expect(agent.name).toBe('fundamentalsAnalyst')
    expect(agent.role).toBe('researcher')
  })

  it('captures fundamentalScore and keyMetrics', async () => {
    const llm = mockLLM(
      '{"stance":"bull","fundamentalScore":78,"keyMetrics":{"PE":25,"revenueGrowth":0.12,"profitMargin":0.24},"evidence":["Strong balance sheet"],"confidence":0.85}'
    )
    const agent = new FundamentalsAnalyst({ llm })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].fundamentalScore).toBe(78)
    expect(result.researchFindings[0].keyMetrics?.PE).toBe(25)
    expect(result.researchFindings[0].agentName).toBe('fundamentalsAnalyst')
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new FundamentalsAnalyst({ llm: mockLLM('bad') })
    const result = await agent.run(emptyReport())
    expect(result.researchFindings[0].confidence).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/agents/researcher/fundamentalsAnalyst.test.ts
```
Expected: FAIL — "Cannot find module '...FundamentalsAnalyst.js'"

- [ ] **Step 3: Write FundamentalsAnalyst**

```ts
// src/agents/researcher/FundamentalsAnalyst.ts
import { BaseResearcher } from './BaseResearcher.js'
import type { TradingReport } from '../base/types.js'

export class FundamentalsAnalyst extends BaseResearcher {
  readonly name = 'fundamentalsAnalyst'

  protected buildQuery(report: TradingReport): string {
    return `financial fundamentals earnings revenue PE ratio for ${report.ticker}`
  }

  protected buildSystemPrompt(report: TradingReport, context: string): string {
    return `You are a fundamental equity analyst. Assess the financial health of ${report.ticker}.
${context ? `\nFundamentals data:\n${context}\n` : ''}
Respond with ONLY a JSON object matching this schema:
{
  "stance": "bull" | "bear" | "neutral",
  "fundamentalScore": <number 0-100>,
  "keyMetrics": { "PE": <number>, "revenueGrowth": <number>, "profitMargin": <number> },
  "evidence": ["<fundamental point 1>", "<fundamental point 2>"],
  "confidence": <number 0-1>
}`
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- tests/agents/researcher/fundamentalsAnalyst.test.ts
```
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/agents/researcher/FundamentalsAnalyst.ts tests/agents/researcher/fundamentalsAnalyst.test.ts
git commit -m "feat: add FundamentalsAnalyst agent"
```

---

## Task 6: RiskAnalyst

**Files:**
- Create: `src/agents/risk/RiskAnalyst.ts`
- Create: `tests/agents/risk/riskAnalyst.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agents/risk/riskAnalyst.test.ts
import { describe, it, expect, vi } from 'vitest'
import { RiskAnalyst } from '../../../src/agents/risk/RiskAnalyst.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function reportWithData(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [{ ticker: 'AAPL', market: 'US', type: 'ohlcv', data: [{ close: 150 }], fetchedAt: new Date() }],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: ['Strong earnings'], confidence: 0.8 },
    ],
  }
}

describe('RiskAnalyst', () => {
  it('has correct name and role', () => {
    const agent = new RiskAnalyst({ llm: mockLLM('{}') })
    expect(agent.name).toBe('riskAnalyst')
    expect(agent.role).toBe('risk')
  })

  it('sets riskAssessment with metrics on the report', async () => {
    const llm = mockLLM(
      '{"riskLevel":"medium","metrics":{"VaR":0.03,"volatility":0.22,"beta":1.1,"maxDrawdown":0.15}}'
    )
    const agent = new RiskAnalyst({ llm })
    const result = await agent.run(reportWithData())
    expect(result.riskAssessment).toBeDefined()
    expect(result.riskAssessment?.riskLevel).toBe('medium')
    expect(result.riskAssessment?.metrics.VaR).toBe(0.03)
    expect(result.riskAssessment?.metrics.volatility).toBe(0.22)
  })

  it('calls LLM with ticker in context', async () => {
    const llm = mockLLM(
      '{"riskLevel":"low","metrics":{"VaR":0.01,"volatility":0.1,"beta":0.8,"maxDrawdown":0.05}}'
    )
    const agent = new RiskAnalyst({ llm })
    await agent.run(reportWithData())
    expect(llm.chat).toHaveBeenCalledOnce()
    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(messages[0].content).toContain('AAPL')
  })

  it('falls back to default values on malformed LLM response', async () => {
    const agent = new RiskAnalyst({ llm: mockLLM('not json') })
    const result = await agent.run(reportWithData())
    expect(result.riskAssessment?.riskLevel).toBe('medium')
    expect(result.riskAssessment?.metrics.VaR).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/agents/risk/riskAnalyst.test.ts
```
Expected: FAIL — "Cannot find module '...RiskAnalyst.js'"

- [ ] **Step 3: Write RiskAnalyst**

```ts
// src/agents/risk/RiskAnalyst.ts
import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, RiskAssessment, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'

type RiskAnalystConfig = {
  llm: ILLMProvider
}

export class RiskAnalyst implements IAgent {
  readonly name = 'riskAnalyst'
  readonly role: AgentRole = 'risk'

  private llm: ILLMProvider

  constructor(config: RiskAnalystConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const context = this.buildContext(report)
    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are a quantitative risk analyst. Calculate risk metrics for ${report.ticker}.
${context}
Respond with ONLY a JSON object matching this schema:
{
  "riskLevel": "low" | "medium" | "high",
  "metrics": {
    "VaR": <number, 1-day Value at Risk as decimal e.g. 0.03>,
    "volatility": <number, annualized volatility as decimal e.g. 0.22>,
    "beta": <number, beta vs market e.g. 1.1>,
    "maxDrawdown": <number, max drawdown as decimal e.g. 0.15>
  }
}`,
      },
      { role: 'user', content: `Calculate risk metrics for ${report.ticker}. Respond with JSON only.` },
    ])

    const partial = this.parseAssessment(response)
    return {
      ...report,
      riskAssessment: {
        riskLevel: partial.riskLevel ?? 'medium',
        metrics: partial.metrics ?? { VaR: 0, volatility: 0, beta: 1, maxDrawdown: 0 },
      },
    }
  }

  private buildContext(report: TradingReport): string {
    const lines: string[] = []
    const priceData = report.rawData.filter((d) => d.type === 'ohlcv')
    if (priceData.length > 0) {
      lines.push(`Price data: ${JSON.stringify(priceData[0].data).slice(0, 500)}`)
    }
    if (report.researchFindings.length > 0) {
      const summary = report.researchFindings
        .map((f) => `${f.agentName}: ${f.stance} (confidence: ${f.confidence})`)
        .join(', ')
      lines.push(`Research findings: ${summary}`)
    }
    return lines.join('\n')
  }

  private parseAssessment(response: string): Partial<RiskAssessment> {
    try {
      return parseJson<Partial<RiskAssessment>>(response)
    } catch {
      return {}
    }
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- tests/agents/risk/riskAnalyst.test.ts
```
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/agents/risk/RiskAnalyst.ts tests/agents/risk/riskAnalyst.test.ts
git commit -m "feat: add RiskAnalyst agent"
```

---

## Task 7: RiskManager

**Files:**
- Create: `src/agents/risk/RiskManager.ts`
- Create: `tests/agents/risk/riskManager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agents/risk/riskManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { RiskManager } from '../../../src/agents/risk/RiskManager.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function reportWithRisk(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: [], confidence: 0.8 },
    ],
    riskAssessment: {
      riskLevel: 'medium',
      metrics: { VaR: 0.03, volatility: 0.22, beta: 1.1, maxDrawdown: 0.15 },
    },
  }
}

describe('RiskManager', () => {
  it('has correct name and role', () => {
    const agent = new RiskManager({ llm: mockLLM('{}') })
    expect(agent.name).toBe('riskManager')
    expect(agent.role).toBe('risk')
  })

  it('augments existing riskAssessment with position limits', async () => {
    const llm = mockLLM('{"maxPositionSize":0.05,"stopLoss":145.00,"takeProfit":165.00}')
    const agent = new RiskManager({ llm })
    const result = await agent.run(reportWithRisk())
    expect(result.riskAssessment?.maxPositionSize).toBe(0.05)
    expect(result.riskAssessment?.stopLoss).toBe(145.00)
    expect(result.riskAssessment?.takeProfit).toBe(165.00)
    // metrics from RiskAnalyst must be preserved
    expect(result.riskAssessment?.metrics.VaR).toBe(0.03)
  })

  it('returns report unchanged when no riskAssessment present', async () => {
    const llm = mockLLM('{"maxPositionSize":0.05}')
    const agent = new RiskManager({ llm })
    const report: TradingReport = {
      ticker: 'AAPL', market: 'US', timestamp: new Date(), rawData: [], researchFindings: [],
    }
    const result = await agent.run(report)
    expect(result.riskAssessment).toBeUndefined()
    expect(llm.chat).not.toHaveBeenCalled()
  })

  it('handles malformed LLM response gracefully', async () => {
    const agent = new RiskManager({ llm: mockLLM('not json') })
    const result = await agent.run(reportWithRisk())
    expect(result.riskAssessment?.riskLevel).toBe('medium')
    expect(result.riskAssessment?.maxPositionSize).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/agents/risk/riskManager.test.ts
```
Expected: FAIL — "Cannot find module '...RiskManager.js'"

- [ ] **Step 3: Write RiskManager**

```ts
// src/agents/risk/RiskManager.ts
import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'

type RiskManagerConfig = {
  llm: ILLMProvider
}

type PositionLimits = {
  maxPositionSize?: number
  stopLoss?: number
  takeProfit?: number
}

export class RiskManager implements IAgent {
  readonly name = 'riskManager'
  readonly role: AgentRole = 'risk'

  private llm: ILLMProvider

  constructor(config: RiskManagerConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    if (!report.riskAssessment) return report

    const context = this.buildContext(report)
    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are a risk manager. Set position sizing and risk limits for ${report.ticker}.
${context}
Respond with ONLY a JSON object matching this schema:
{
  "maxPositionSize": <number, fraction of portfolio e.g. 0.05>,
  "stopLoss": <number, price level>,
  "takeProfit": <number, price level>
}`,
      },
      { role: 'user', content: `Set position limits for ${report.ticker}. Respond with JSON only.` },
    ])

    const limits = this.parseLimits(response)
    return {
      ...report,
      riskAssessment: {
        ...report.riskAssessment,
        maxPositionSize: limits.maxPositionSize,
        stopLoss: limits.stopLoss,
        takeProfit: limits.takeProfit,
      },
    }
  }

  private buildContext(report: TradingReport): string {
    const ra = report.riskAssessment!
    const stances = report.researchFindings.map((f) => `${f.agentName}: ${f.stance}`).join(', ')
    return [
      `Risk level: ${ra.riskLevel}`,
      `VaR: ${ra.metrics.VaR}, Volatility: ${ra.metrics.volatility}, Beta: ${ra.metrics.beta}, Max Drawdown: ${ra.metrics.maxDrawdown}`,
      stances ? `Research stances: ${stances}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  private parseLimits(response: string): PositionLimits {
    try {
      return parseJson<PositionLimits>(response)
    } catch {
      return {}
    }
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- tests/agents/risk/riskManager.test.ts
```
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/agents/risk/RiskManager.ts tests/agents/risk/riskManager.test.ts
git commit -m "feat: add RiskManager agent"
```

---

## Task 8: Manager

**Files:**
- Create: `src/agents/manager/Manager.ts`
- Create: `tests/agents/manager/manager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agents/manager/manager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Manager } from '../../../src/agents/manager/Manager.js'
import type { ILLMProvider } from '../../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function fullReport(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: ['Strong earnings'], confidence: 0.8 },
      { agentName: 'bearResearcher', stance: 'bear', evidence: ['High valuation'], confidence: 0.6 },
    ],
    riskAssessment: {
      riskLevel: 'medium',
      metrics: { VaR: 0.03, volatility: 0.22, beta: 1.1, maxDrawdown: 0.15 },
      maxPositionSize: 0.05,
      stopLoss: 145.00,
      takeProfit: 165.00,
    },
  }
}

describe('Manager', () => {
  it('has correct name and role', () => {
    const agent = new Manager({ llm: mockLLM('{}') })
    expect(agent.name).toBe('manager')
    expect(agent.role).toBe('manager')
  })

  it('sets finalDecision on the report', async () => {
    const llm = mockLLM(
      '{"action":"BUY","confidence":0.73,"reasoning":"Bull evidence outweighs bear evidence","suggestedPositionSize":0.04,"stopLoss":145.00,"takeProfit":165.00}'
    )
    const agent = new Manager({ llm })
    const result = await agent.run(fullReport())
    expect(result.finalDecision).toBeDefined()
    expect(result.finalDecision?.action).toBe('BUY')
    expect(result.finalDecision?.confidence).toBe(0.73)
    expect(result.finalDecision?.reasoning).toBe('Bull evidence outweighs bear evidence')
  })

  it('falls back to HOLD with confidence 0 on malformed response', async () => {
    const agent = new Manager({ llm: mockLLM('not json') })
    const result = await agent.run(fullReport())
    expect(result.finalDecision?.action).toBe('HOLD')
    expect(result.finalDecision?.confidence).toBe(0)
  })

  it('includes all agent names in LLM context', async () => {
    const llm = mockLLM('{"action":"SELL","confidence":0.65,"reasoning":"Risk too high"}')
    const agent = new Manager({ llm })
    await agent.run(fullReport())
    const messages = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(messages[0].content).toContain('bullResearcher')
    expect(messages[0].content).toContain('bearResearcher')
    expect(messages[0].content).toContain('medium')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/agents/manager/manager.test.ts
```
Expected: FAIL — "Cannot find module '...Manager.js'"

- [ ] **Step 3: Write Manager**

```ts
// src/agents/manager/Manager.ts
import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, Decision, TradingReport } from '../base/types.js'
import type { ILLMProvider } from '../../llm/ILLMProvider.js'
import { parseJson } from '../../utils/parseJson.js'

type ManagerConfig = {
  llm: ILLMProvider
}

export class Manager implements IAgent {
  readonly name = 'manager'
  readonly role: AgentRole = 'manager'

  private llm: ILLMProvider

  constructor(config: ManagerConfig) {
    this.llm = config.llm
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const context = this.buildContext(report)
    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are a senior portfolio manager making a final trading decision for ${report.ticker}.
${context}
Weigh the bull and bear evidence against the risk assessment. Make a final BUY, SELL, or HOLD recommendation.
Respond with ONLY a JSON object matching this schema:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": <number 0-1>,
  "reasoning": "<clear explanation of the decision>",
  "suggestedPositionSize": <number, fraction of portfolio>,
  "stopLoss": <number or null>,
  "takeProfit": <number or null>
}`,
      },
      { role: 'user', content: `Make a final decision for ${report.ticker}. Respond with JSON only.` },
    ])

    const decision = this.parseDecision(response)
    return { ...report, finalDecision: decision }
  }

  private buildContext(report: TradingReport): string {
    const lines: string[] = []
    for (const f of report.researchFindings) {
      lines.push(`${f.agentName}: ${f.stance} (confidence: ${f.confidence})`)
      if (f.evidence.length > 0) lines.push(`  Evidence: ${f.evidence.slice(0, 3).join('; ')}`)
      if (f.sentiment) lines.push(`  Sentiment: ${f.sentiment}`)
      if (f.fundamentalScore !== undefined) lines.push(`  Fundamental score: ${f.fundamentalScore}`)
    }
    if (report.riskAssessment) {
      const ra = report.riskAssessment
      lines.push(`Risk: ${ra.riskLevel} | VaR: ${ra.metrics.VaR} | Volatility: ${ra.metrics.volatility}`)
      if (ra.maxPositionSize !== undefined) lines.push(`Max position: ${ra.maxPositionSize}`)
      if (ra.stopLoss !== undefined) lines.push(`Stop loss: ${ra.stopLoss}`)
    }
    return lines.join('\n')
  }

  private parseDecision(response: string): Decision {
    try {
      const parsed = parseJson<Partial<Decision>>(response)
      return {
        action: parsed.action ?? 'HOLD',
        confidence: parsed.confidence ?? 0.5,
        reasoning: parsed.reasoning ?? 'Unable to parse manager response',
        suggestedPositionSize: parsed.suggestedPositionSize,
        stopLoss: parsed.stopLoss,
        takeProfit: parsed.takeProfit,
      }
    } catch {
      return {
        action: 'HOLD',
        confidence: 0,
        reasoning: 'Manager was unable to parse LLM response',
      }
    }
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- tests/agents/manager/manager.test.ts
```
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/agents/manager/Manager.ts tests/agents/manager/manager.test.ts
git commit -m "feat: add Manager agent"
```

---

## Task 9: Orchestrator

**Files:**
- Create: `src/orchestrator/Orchestrator.ts`
- Create: `tests/orchestrator/orchestrator.test.ts`

> **Important design note:** The researcher team runs in parallel (each researcher gets a copy of the base report; findings are merged afterward). The risk team runs **sequentially** because `RiskManager` depends on `riskAssessment` set by `RiskAnalyst`. The Manager runs last.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orchestrator/orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Orchestrator } from '../../src/orchestrator/Orchestrator.js'
import type { IAgent } from '../../src/agents/base/IAgent.js'
import type { AgentRole, TradingReport } from '../../src/agents/base/types.js'

function mockAgent(
  name: string,
  role: AgentRole,
  transform: (r: TradingReport) => TradingReport
): IAgent {
  return {
    name,
    role,
    run: vi.fn().mockImplementation((r: TradingReport) => Promise.resolve(transform(r))),
  }
}

describe('Orchestrator', () => {
  it('runs dataFetcher first and manager last', async () => {
    const callOrder: string[] = []

    const dataFetcher = mockAgent('dataFetcher', 'data', (r) => {
      callOrder.push('dataFetcher')
      return r
    })
    const bull = mockAgent('bull', 'researcher', (r) => {
      callOrder.push('bull')
      return { ...r, researchFindings: [...r.researchFindings, { agentName: 'bull', stance: 'bull' as const, evidence: [], confidence: 0.8 }] }
    })
    const riskAnalyst = mockAgent('riskAnalyst', 'risk', (r) => {
      callOrder.push('riskAnalyst')
      return { ...r, riskAssessment: { riskLevel: 'medium' as const, metrics: { VaR: 0.03, volatility: 0.22, beta: 1.1, maxDrawdown: 0.15 } } }
    })
    const riskManager = mockAgent('riskManager', 'risk', (r) => {
      callOrder.push('riskManager')
      return r
    })
    const manager = mockAgent('manager', 'manager', (r) => {
      callOrder.push('manager')
      return { ...r, finalDecision: { action: 'BUY' as const, confidence: 0.7, reasoning: 'test' } }
    })

    const orchestrator = new Orchestrator({
      dataFetcher,
      researcherTeam: [bull],
      riskTeam: [riskAnalyst, riskManager],
      manager,
    })

    const result = await orchestrator.run('AAPL', 'US')

    expect(callOrder[0]).toBe('dataFetcher')
    expect(callOrder[callOrder.length - 1]).toBe('manager')
    expect(callOrder.indexOf('riskAnalyst')).toBeLessThan(callOrder.indexOf('riskManager'))
    expect(result.finalDecision?.action).toBe('BUY')
  })

  it('merges all researcher findings into the report', async () => {
    const bull = mockAgent('bull', 'researcher', (r) => ({
      ...r,
      researchFindings: [...r.researchFindings, { agentName: 'bull', stance: 'bull' as const, evidence: [], confidence: 0.8 }],
    }))
    const bear = mockAgent('bear', 'researcher', (r) => ({
      ...r,
      researchFindings: [...r.researchFindings, { agentName: 'bear', stance: 'bear' as const, evidence: [], confidence: 0.6 }],
    }))
    const riskAnalyst = mockAgent('riskAnalyst', 'risk', (r) => ({
      ...r,
      riskAssessment: { riskLevel: 'low' as const, metrics: { VaR: 0.01, volatility: 0.1, beta: 0.9, maxDrawdown: 0.05 } },
    }))
    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: { action: 'HOLD' as const, confidence: 0.5, reasoning: 'neutral' },
    }))

    const orchestrator = new Orchestrator({
      researcherTeam: [bull, bear],
      riskTeam: [riskAnalyst],
      manager,
    })

    const result = await orchestrator.run('TSLA', 'US')
    expect(result.researchFindings).toHaveLength(2)
    expect(result.researchFindings.map((f) => f.agentName)).toContain('bull')
    expect(result.researchFindings.map((f) => f.agentName)).toContain('bear')
  })

  it('works without a dataFetcher', async () => {
    const riskAnalyst = mockAgent('riskAnalyst', 'risk', (r) => ({
      ...r,
      riskAssessment: { riskLevel: 'low' as const, metrics: { VaR: 0.01, volatility: 0.1, beta: 0.9, maxDrawdown: 0.05 } },
    }))
    const manager = mockAgent('manager', 'manager', (r) => ({
      ...r,
      finalDecision: { action: 'HOLD' as const, confidence: 0.5, reasoning: 'no data' },
    }))
    const orchestrator = new Orchestrator({ researcherTeam: [], riskTeam: [riskAnalyst], manager })
    const result = await orchestrator.run('AAPL', 'US')
    expect(result.finalDecision).toBeDefined()
    expect(result.ticker).toBe('AAPL')
    expect(result.market).toBe('US')
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/orchestrator/orchestrator.test.ts
```
Expected: FAIL — "Cannot find module '...Orchestrator.js'"

- [ ] **Step 3: Write Orchestrator**

```ts
// src/orchestrator/Orchestrator.ts
import type { IAgent } from '../agents/base/IAgent.js'
import type { Market, TradingReport } from '../agents/base/types.js'

type OrchestratorConfig = {
  dataFetcher?: IAgent
  researcherTeam: IAgent[]
  riskTeam: IAgent[]
  manager: IAgent
}

export class Orchestrator {
  private dataFetcher?: IAgent
  private researcherTeam: IAgent[]
  private riskTeam: IAgent[]
  private manager: IAgent

  constructor(config: OrchestratorConfig) {
    this.dataFetcher = config.dataFetcher
    this.researcherTeam = config.researcherTeam
    this.riskTeam = config.riskTeam
    this.manager = config.manager
  }

  async run(ticker: string, market: Market): Promise<TradingReport> {
    let report: TradingReport = {
      ticker,
      market,
      timestamp: new Date(),
      rawData: [],
      researchFindings: [],
    }

    // Stage 1: Data fetching
    if (this.dataFetcher) {
      report = await this.dataFetcher.run(report)
    }

    // Stage 2: Researcher team — parallel
    // Each agent gets a copy of the current report so they don't conflict.
    // Findings from all researchers are merged back into the main report.
    if (this.researcherTeam.length > 0) {
      const researcherResults = await Promise.all(
        this.researcherTeam.map((agent) => agent.run({ ...report }))
      )
      report = {
        ...report,
        researchFindings: [
          ...report.researchFindings,
          ...researcherResults.flatMap((r) => r.researchFindings),
        ],
      }
    }

    // Stage 3: Risk team — sequential
    // RiskManager depends on riskAssessment set by RiskAnalyst, so they must run in order.
    for (const agent of this.riskTeam) {
      report = await agent.run(report)
    }

    // Stage 4: Manager — reads full report, outputs final decision
    report = await this.manager.run(report)

    return report
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- tests/orchestrator/orchestrator.test.ts
```
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/Orchestrator.ts tests/orchestrator/orchestrator.test.ts
git commit -m "feat: add Orchestrator — parallel researcher team, sequential risk team, manager"
```

---

## Task 10: IEvaluator + ReasoningEvaluator

**Files:**
- Create: `src/evaluation/IEvaluator.ts`
- Create: `src/evaluation/ReasoningEvaluator.ts`
- Create: `tests/evaluation/reasoningEvaluator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/evaluation/reasoningEvaluator.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ReasoningEvaluator } from '../../src/evaluation/ReasoningEvaluator.js'
import type { ILLMProvider } from '../../src/llm/ILLMProvider.js'
import type { TradingReport } from '../../src/agents/base/types.js'

function mockLLM(response: string): ILLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue(response),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

function reportWithDecision(): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [
      { agentName: 'bullResearcher', stance: 'bull', evidence: ['Strong earnings growth'], confidence: 0.8 },
    ],
    finalDecision: { action: 'BUY', confidence: 0.75, reasoning: 'Bull evidence is strong' },
  }
}

describe('ReasoningEvaluator', () => {
  it('returns EvaluationResult with score averaged over three dimensions', async () => {
    const llm = mockLLM(
      '{"logicalConsistency":0.8,"evidenceQuality":0.7,"confidenceCalibration":0.9,"notes":"Good analysis"}'
    )
    const evaluator = new ReasoningEvaluator({ llm })
    const result = await evaluator.evaluate(reportWithDecision())
    expect(result.score).toBeCloseTo((0.8 + 0.7 + 0.9) / 3)
    expect(result.breakdown.logicalConsistency).toBe(0.8)
    expect(result.breakdown.evidenceQuality).toBe(0.7)
    expect(result.breakdown.confidenceCalibration).toBe(0.9)
    expect(result.notes).toBe('Good analysis')
  })

  it('falls back to default 0.5 scores on malformed LLM response', async () => {
    const evaluator = new ReasoningEvaluator({ llm: mockLLM('bad json') })
    const result = await evaluator.evaluate(reportWithDecision())
    expect(result.score).toBeCloseTo(0.5)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/evaluation/reasoningEvaluator.test.ts
```
Expected: FAIL — "Cannot find module '...ReasoningEvaluator.js'"

- [ ] **Step 3: Write IEvaluator**

```ts
// src/evaluation/IEvaluator.ts
import type { TradingReport } from '../agents/base/types.js'

export type EvaluationResult = {
  score: number
  breakdown: Record<string, number>
  notes: string
}

export interface IEvaluator {
  evaluate(report: TradingReport): Promise<EvaluationResult>
}
```

- [ ] **Step 4: Write ReasoningEvaluator**

```ts
// src/evaluation/ReasoningEvaluator.ts
import type { IEvaluator, EvaluationResult } from './IEvaluator.js'
import type { TradingReport } from '../agents/base/types.js'
import type { ILLMProvider } from '../llm/ILLMProvider.js'
import { parseJson } from '../utils/parseJson.js'

type ReasoningEvaluatorConfig = {
  llm: ILLMProvider
}

type JudgmentResult = {
  logicalConsistency: number
  evidenceQuality: number
  confidenceCalibration: number
  notes: string
}

export class ReasoningEvaluator implements IEvaluator {
  private llm: ILLMProvider

  constructor(config: ReasoningEvaluatorConfig) {
    this.llm = config.llm
  }

  async evaluate(report: TradingReport): Promise<EvaluationResult> {
    const context = this.buildContext(report)
    const response = await this.llm.chat([
      {
        role: 'system',
        content: `You are an expert evaluator of trading research quality. Score the following analysis for ${report.ticker}.
${context}
Respond with ONLY a JSON object:
{
  "logicalConsistency": <number 0-1>,
  "evidenceQuality": <number 0-1>,
  "confidenceCalibration": <number 0-1>,
  "notes": "<brief explanation>"
}`,
      },
      { role: 'user', content: 'Evaluate the quality of this trading analysis. Respond with JSON only.' },
    ])

    const judgment = this.parseJudgment(response)
    const score =
      (judgment.logicalConsistency + judgment.evidenceQuality + judgment.confidenceCalibration) / 3

    return {
      score,
      breakdown: {
        logicalConsistency: judgment.logicalConsistency,
        evidenceQuality: judgment.evidenceQuality,
        confidenceCalibration: judgment.confidenceCalibration,
      },
      notes: judgment.notes,
    }
  }

  private buildContext(report: TradingReport): string {
    const lines: string[] = [`Ticker: ${report.ticker}`, `Market: ${report.market}`]
    for (const f of report.researchFindings) {
      lines.push(`${f.agentName}: ${f.stance} (confidence: ${f.confidence})`)
      if (f.evidence.length > 0) lines.push(`  Evidence: ${f.evidence.join('; ')}`)
    }
    if (report.finalDecision) {
      const d = report.finalDecision
      lines.push(`Final decision: ${d.action} (confidence: ${d.confidence})`)
      lines.push(`Reasoning: ${d.reasoning}`)
    }
    return lines.join('\n')
  }

  private parseJudgment(response: string): JudgmentResult {
    try {
      return parseJson<JudgmentResult>(response)
    } catch {
      return {
        logicalConsistency: 0.5,
        evidenceQuality: 0.5,
        confidenceCalibration: 0.5,
        notes: 'Unable to parse evaluator response',
      }
    }
  }
}
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
npm test -- tests/evaluation/reasoningEvaluator.test.ts
```
Expected: PASS — 2 tests

- [ ] **Step 6: Commit**

```bash
git add src/evaluation/IEvaluator.ts src/evaluation/ReasoningEvaluator.ts tests/evaluation/reasoningEvaluator.test.ts
git commit -m "feat: add IEvaluator interface and ReasoningEvaluator (LLM-as-judge)"
```

---

## Task 11: AccuracyEvaluator

**Files:**
- Create: `src/evaluation/AccuracyEvaluator.ts`
- Create: `tests/evaluation/accuracyEvaluator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/evaluation/accuracyEvaluator.test.ts
import { describe, it, expect } from 'vitest'
import { AccuracyEvaluator } from '../../src/evaluation/AccuracyEvaluator.js'
import type { TradingReport } from '../../src/agents/base/types.js'

function reportWithDecision(action: 'BUY' | 'SELL' | 'HOLD', confidence: number): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [],
    finalDecision: { action, confidence, reasoning: 'test' },
  }
}

describe('AccuracyEvaluator', () => {
  it('returns score 0 when report has no final decision', async () => {
    const report: TradingReport = {
      ticker: 'AAPL', market: 'US', timestamp: new Date(), rawData: [], researchFindings: [],
    }
    const evaluator = new AccuracyEvaluator(0.05)
    const result = await evaluator.evaluate(report)
    expect(result.score).toBe(0)
    expect(result.breakdown.directionalAccuracy).toBe(0)
  })

  it('directionalAccuracy = 1 when BUY and price went up', async () => {
    const evaluator = new AccuracyEvaluator(0.10)
    const result = await evaluator.evaluate(reportWithDecision('BUY', 0.9))
    expect(result.breakdown.directionalAccuracy).toBe(1)
  })

  it('directionalAccuracy = 0 when BUY and price went down', async () => {
    const evaluator = new AccuracyEvaluator(-0.05)
    const result = await evaluator.evaluate(reportWithDecision('BUY', 0.8))
    expect(result.breakdown.directionalAccuracy).toBe(0)
  })

  it('directionalAccuracy = 1 when SELL and price went down', async () => {
    const evaluator = new AccuracyEvaluator(-0.08)
    const result = await evaluator.evaluate(reportWithDecision('SELL', 0.7))
    expect(result.breakdown.directionalAccuracy).toBe(1)
  })

  it('directionalAccuracy = 0.5 for HOLD regardless of direction', async () => {
    const evaluator = new AccuracyEvaluator(0.05)
    const result = await evaluator.evaluate(reportWithDecision('HOLD', 0.5))
    expect(result.breakdown.directionalAccuracy).toBe(0.5)
  })

  it('score is average of directionalAccuracy and confidenceCalibration', async () => {
    const evaluator = new AccuracyEvaluator(0.10) // price up
    const result = await evaluator.evaluate(reportWithDecision('BUY', 0.9))
    // correct (directional = 1) + high confidence = confidenceCalibration = 0.9
    expect(result.score).toBeCloseTo((1 + 0.9) / 2)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/evaluation/accuracyEvaluator.test.ts
```
Expected: FAIL — "Cannot find module '...AccuracyEvaluator.js'"

- [ ] **Step 3: Write AccuracyEvaluator**

```ts
// src/evaluation/AccuracyEvaluator.ts
import type { IEvaluator, EvaluationResult } from './IEvaluator.js'
import type { TradingReport } from '../agents/base/types.js'

/**
 * AccuracyEvaluator — measures directional accuracy and confidence calibration.
 * @param actualReturn Actual price return after the evaluation period
 *   (positive = price went up, negative = price went down).
 */
export class AccuracyEvaluator implements IEvaluator {
  constructor(private actualReturn: number) {}

  async evaluate(report: TradingReport): Promise<EvaluationResult> {
    const decision = report.finalDecision
    if (!decision) {
      return {
        score: 0,
        breakdown: { directionalAccuracy: 0, confidenceCalibration: 0 },
        notes: 'No final decision in report',
      }
    }

    const actualUp = this.actualReturn > 0

    let directionalAccuracy: number
    if (decision.action === 'HOLD') {
      directionalAccuracy = 0.5
    } else if (
      (decision.action === 'BUY' && actualUp) ||
      (decision.action === 'SELL' && !actualUp)
    ) {
      directionalAccuracy = 1
    } else {
      directionalAccuracy = 0
    }

    // Correct + confident = good. Wrong + confident = bad.
    const confidenceCalibration =
      directionalAccuracy === 1 ? decision.confidence : 1 - decision.confidence

    const score = (directionalAccuracy + confidenceCalibration) / 2

    return {
      score,
      breakdown: { directionalAccuracy, confidenceCalibration },
      notes: `Decision: ${decision.action} (confidence: ${decision.confidence.toFixed(2)}), actual return: ${(this.actualReturn * 100).toFixed(2)}%`,
    }
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- tests/evaluation/accuracyEvaluator.test.ts
```
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/evaluation/AccuracyEvaluator.ts tests/evaluation/accuracyEvaluator.test.ts
git commit -m "feat: add AccuracyEvaluator — directional accuracy and confidence calibration"
```

---

## Task 12: BacktestEvaluator

**Files:**
- Create: `src/evaluation/BacktestEvaluator.ts`
- Create: `tests/evaluation/backtestEvaluator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/evaluation/backtestEvaluator.test.ts
import { describe, it, expect } from 'vitest'
import { BacktestEvaluator } from '../../src/evaluation/BacktestEvaluator.js'
import type { TradingReport } from '../../src/agents/base/types.js'

function reportWithDecision(action: 'BUY' | 'SELL' | 'HOLD', confidence: number): TradingReport {
  return {
    ticker: 'AAPL',
    market: 'US',
    timestamp: new Date(),
    rawData: [],
    researchFindings: [],
    finalDecision: { action, confidence, reasoning: 'test' },
  }
}

describe('BacktestEvaluator', () => {
  it('returns zero score for empty entries', async () => {
    const evaluator = new BacktestEvaluator([])
    const result = await evaluator.runBacktest()
    expect(result.score).toBe(0)
    expect(result.notes).toContain('No backtest entries')
  })

  it('computes win rate and aggregate score over entries', async () => {
    const entries = [
      { report: reportWithDecision('BUY', 0.8), actualReturn: 0.10 },   // correct
      { report: reportWithDecision('BUY', 0.7), actualReturn: -0.05 },  // wrong
      { report: reportWithDecision('SELL', 0.9), actualReturn: -0.08 }, // correct
    ]
    const evaluator = new BacktestEvaluator(entries)
    const result = await evaluator.runBacktest()
    expect(result.score).toBeGreaterThan(0)
    expect(result.breakdown.winRate).toBeCloseTo(2 / 3)
  })

  it('includes sharpeRatio and maxDrawdown in breakdown', async () => {
    const entries = [
      { report: reportWithDecision('BUY', 0.8), actualReturn: 0.10 },
      { report: reportWithDecision('BUY', 0.7), actualReturn: 0.05 },
    ]
    const evaluator = new BacktestEvaluator(entries)
    const result = await evaluator.runBacktest()
    expect(result.breakdown).toHaveProperty('sharpeRatio')
    expect(result.breakdown).toHaveProperty('maxDrawdown')
  })

  it('evaluate() delegates to runBacktest()', async () => {
    const entries = [{ report: reportWithDecision('BUY', 0.8), actualReturn: 0.10 }]
    const evaluator = new BacktestEvaluator(entries)
    const report = reportWithDecision('HOLD', 0.5)
    const result = await evaluator.evaluate(report)
    expect(result.score).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- tests/evaluation/backtestEvaluator.test.ts
```
Expected: FAIL — "Cannot find module '...BacktestEvaluator.js'"

- [ ] **Step 3: Write BacktestEvaluator**

```ts
// src/evaluation/BacktestEvaluator.ts
import type { IEvaluator, EvaluationResult } from './IEvaluator.js'
import type { TradingReport } from '../agents/base/types.js'
import { AccuracyEvaluator } from './AccuracyEvaluator.js'

export type BacktestEntry = {
  report: TradingReport
  actualReturn: number
}

export class BacktestEvaluator implements IEvaluator {
  constructor(private entries: BacktestEntry[]) {}

  /** evaluate() runs the full backtest (the report argument is ignored). */
  async evaluate(_report: TradingReport): Promise<EvaluationResult> {
    return this.runBacktest()
  }

  async runBacktest(): Promise<EvaluationResult> {
    if (this.entries.length === 0) {
      return { score: 0, breakdown: {}, notes: 'No backtest entries' }
    }

    const results = await Promise.all(
      this.entries.map((entry) =>
        new AccuracyEvaluator(entry.actualReturn).evaluate(entry.report)
      )
    )

    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length
    const winRate =
      results.filter((r) => r.breakdown.directionalAccuracy === 1).length / results.length

    const buyReturns = this.entries
      .filter((e) => e.report.finalDecision?.action === 'BUY')
      .map((e) => e.actualReturn)
    const sharpeRatio = this.computeSharpe(buyReturns)
    const maxDrawdown = this.computeMaxDrawdown(this.entries.map((e) => e.actualReturn))

    return {
      score: avgScore,
      breakdown: { winRate, sharpeRatio, maxDrawdown },
      notes: `Backtest over ${this.entries.length} periods. Win rate: ${(winRate * 100).toFixed(1)}%`,
    }
  }

  private computeSharpe(returns: number[]): number {
    if (returns.length === 0) return 0
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
    const stdDev = Math.sqrt(variance)
    return stdDev === 0 ? 0 : mean / stdDev
  }

  private computeMaxDrawdown(returns: number[]): number {
    let peak = 1
    let equity = 1
    let maxDd = 0
    for (const r of returns) {
      equity *= 1 + r
      if (equity > peak) peak = equity
      const dd = (peak - equity) / peak
      if (dd > maxDd) maxDd = dd
    }
    return maxDd
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm test -- tests/evaluation/backtestEvaluator.test.ts
```
Expected: PASS — 4 tests

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```
Expected: All tests passing (previous 72 + new ~36 = ~108 tests)

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/evaluation/BacktestEvaluator.ts tests/evaluation/backtestEvaluator.test.ts
git commit -m "feat: add BacktestEvaluator — win rate, Sharpe ratio, max drawdown"
```

---

## Self-Review

### 1. Spec coverage

| Spec requirement | Covered by |
|---|---|
| BullResearcher — finds BUY evidence via RAG | Task 2 |
| BearResearcher — finds SELL evidence via RAG | Task 3 |
| NewsAnalyst — news sentiment, `sentiment` field | Task 4 |
| FundamentalsAnalyst — `fundamentalScore`, `keyMetrics` | Task 5 |
| RiskAnalyst — VaR, volatility, beta, maxDrawdown, riskLevel | Task 6 |
| RiskManager — maxPositionSize, stopLoss, takeProfit | Task 7 |
| Manager — final BUY/SELL/HOLD + confidence + reasoning | Task 8 |
| Orchestrator — researcher team parallel, risk sequential, manager last | Task 9 |
| IEvaluator interface + EvaluationResult type | Task 10 |
| ReasoningEvaluator — LLM-as-judge | Task 10 |
| AccuracyEvaluator — directional accuracy after N days | Task 11 |
| BacktestEvaluator — Sharpe, win rate, drawdown | Task 12 |
| Shared `parseJson` utility for LLM responses | Task 1 |

All spec requirements covered. No gaps found.

### 2. Placeholder scan

No TBD, TODO, or placeholder language found. Every step includes complete code.

### 3. Type consistency

- `BaseResearcher.parseFinding()` returns `Finding` — `agentName`, `stance`, `evidence`, `confidence` match `src/agents/base/types.ts`
- `RiskAnalyst` writes `{ riskLevel, metrics }` — matches `RiskAssessment` type
- `RiskManager` spreads existing `riskAssessment` and adds `maxPositionSize`, `stopLoss`, `takeProfit` — all optional fields in `RiskAssessment`
- `Manager` writes `Decision` — `action`, `confidence`, `reasoning` required; others optional ✓
- `Orchestrator.run()` returns `TradingReport` ✓
- `EvaluationResult` has `score: number`, `breakdown: Record<string, number>`, `notes: string` — used consistently across all evaluators ✓
