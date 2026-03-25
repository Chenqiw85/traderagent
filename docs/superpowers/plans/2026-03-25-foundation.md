# TradingAgent Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the TypeScript project with all shared types, the full LLM adapter layer (5 providers), and a config system — fully tested and committed.

**Architecture:** All LLM providers implement a single `ILLMProvider` interface. A `LLMRegistry` resolves provider instances from config keys at runtime. Every external SDK call is mocked in tests so no API keys are needed to run the test suite.

**Tech Stack:** TypeScript 5.4, Vitest 1.x, openai SDK, @anthropic-ai/sdk, @google/generative-ai, ollama npm package. DeepSeek reuses the OpenAI SDK with a custom base URL.

---

## File Map

```
package.json
tsconfig.json
vitest.config.ts
src/
  llm/
    types.ts              # Message, LLMOptions — shared by all adapters
    ILLMProvider.ts       # interface ILLMProvider
    openai.ts             # OpenAIProvider implements ILLMProvider
    anthropic.ts          # AnthropicProvider
    gemini.ts             # GeminiProvider
    ollama.ts             # OllamaProvider
    deepseek.ts           # DeepSeekProvider (OpenAI-compatible)
    registry.ts           # LLMRegistry — resolves provider by name
  agents/
    base/
      types.ts            # ALL shared domain types (TradingReport, Finding, etc.)
  config/
    config.ts             # agentConfig, dataSourceConfig — maps agent names to providers
tests/
  llm/
    openai.test.ts
    anthropic.test.ts
    gemini.test.ts
    ollama.test.ts
    deepseek.test.ts
    registry.test.ts
```

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "traderagent",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "@google/generative-ai": "^0.15.0",
    "@polygon.io/client-js": "^7.2.0",
    "@qdrant/js-client-rest": "^1.9.0",
    "finnhub": "^1.2.17",
    "ollama": "^0.5.0",
    "openai": "^4.0.0",
    "yahoo-finance2": "^2.11.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
})
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: no output (no files yet, no errors).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts package-lock.json
git commit -m "feat: initialise TypeScript project with Vitest"
```

---

## Task 2: Core Domain Types

**Files:**
- Create: `src/agents/base/types.ts`

- [ ] **Step 1: Create src/agents/base/types.ts**

```ts
// src/agents/base/types.ts

export type AgentRole = 'researcher' | 'risk' | 'manager' | 'data'

export type Market = 'US' | 'CN' | 'HK'

export type DataType = 'ohlcv' | 'news' | 'fundamentals' | 'technicals'

export type DataQuery = {
  ticker: string
  market: Market
  type: DataType
  from?: Date
  to?: Date
}

export type DataResult = {
  ticker: string
  market: Market
  type: DataType
  data: unknown
  fetchedAt: Date
}

export type Finding = {
  agentName: string
  stance: 'bull' | 'bear' | 'neutral'
  evidence: string[]
  confidence: number // 0–1
  sentiment?: string
  fundamentalScore?: number
  keyMetrics?: Record<string, number>
}

export type RiskAssessment = {
  riskLevel: 'low' | 'medium' | 'high'
  metrics: {
    VaR: number
    volatility: number
    beta: number
    maxDrawdown: number
  }
  maxPositionSize?: number
  stopLoss?: number
  takeProfit?: number
}

export type Decision = {
  action: 'BUY' | 'SELL' | 'HOLD'
  confidence: number // 0–1
  reasoning: string
  suggestedPositionSize?: number
  stopLoss?: number
  takeProfit?: number
  agentWeights?: Record<string, number>
}

export type TradingReport = {
  ticker: string
  market: Market
  timestamp: Date
  rawData: DataResult[]
  researchFindings: Finding[]
  riskAssessment?: RiskAssessment
  finalDecision?: Decision
}
```

- [ ] **Step 2: Verify types compile**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/agents/base/types.ts
git commit -m "feat: add core domain types (TradingReport, Finding, Decision, etc.)"
```

---

## Task 3: LLM Shared Types + Interface

**Files:**
- Create: `src/llm/types.ts`
- Create: `src/llm/ILLMProvider.ts`

- [ ] **Step 1: Create src/llm/types.ts**

```ts
// src/llm/types.ts

export type MessageRole = 'system' | 'user' | 'assistant'

export type Message = {
  role: MessageRole
  content: string
}

export type LLMOptions = {
  temperature?: number   // 0–2, default 0.7
  maxTokens?: number
  topP?: number
}
```

- [ ] **Step 2: Create src/llm/ILLMProvider.ts**

```ts
// src/llm/ILLMProvider.ts

import type { Message, LLMOptions } from './types.js'

export interface ILLMProvider {
  readonly name: string
  chat(messages: Message[], options?: LLMOptions): Promise<string>
  chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string>
}
```

- [ ] **Step 3: Verify types compile**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/llm/types.ts src/llm/ILLMProvider.ts
git commit -m "feat: add ILLMProvider interface and LLM types"
```

---

## Task 4: OpenAI Adapter

**Files:**
- Create: `src/llm/openai.ts`
- Create: `tests/llm/openai.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/llm/openai.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAIProvider } from '../../src/llm/openai.js'

vi.mock('openai', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'Hello from OpenAI' } }],
  })
  const mockStream = vi.fn().mockImplementation(async function* () {
    yield { choices: [{ delta: { content: 'Hello' } }] }
    yield { choices: [{ delta: { content: ' world' } }] }
  })
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation((opts) =>
            opts.stream ? mockStream() : mockCreate()
          ),
        },
      },
    })),
  }
})

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider

  beforeEach(() => {
    provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' })
  })

  it('has correct name', () => {
    expect(provider.name).toBe('openai')
  })

  it('chat returns string response', async () => {
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello from OpenAI')
  })

  it('chatStream yields string chunks', async () => {
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['Hello', ' world'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/llm/openai.test.ts
```

Expected: FAIL — `Cannot find module '../../src/llm/openai.js'`

- [ ] **Step 3: Implement OpenAIProvider**

```ts
// src/llm/openai.ts
import OpenAI from 'openai'
import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'

type OpenAIConfig = {
  apiKey: string
  model: string
  baseURL?: string  // allow override for DeepSeek-compatible APIs
}

export class OpenAIProvider implements ILLMProvider {
  readonly name = 'openai'
  private client: OpenAI
  private model: string

  constructor(config: OpenAIConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
    this.model = config.model
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
    })
    return response.choices[0]?.message?.content ?? ''
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
    })
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) yield content
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/llm/openai.test.ts
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/llm/openai.ts tests/llm/openai.test.ts
git commit -m "feat: add OpenAIProvider with chat and chatStream"
```

---

## Task 5: Anthropic Adapter

**Files:**
- Create: `src/llm/anthropic.ts`
- Create: `tests/llm/anthropic.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/llm/anthropic.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AnthropicProvider } from '../../src/llm/anthropic.js'

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'Hello from Anthropic' }],
  })
  const mockStream = vi.fn().mockImplementation(async function* () {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' Claude' } }
  })
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn().mockImplementation((opts) =>
          opts.stream ? mockStream() : mockCreate()
        ),
      },
    })),
  }
})

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider

  beforeEach(() => {
    provider = new AnthropicProvider({ apiKey: 'test-key', model: 'claude-sonnet-4-6' })
  })

  it('has correct name', () => {
    expect(provider.name).toBe('anthropic')
  })

  it('chat returns string response', async () => {
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello from Anthropic')
  })

  it('chatStream yields string chunks', async () => {
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['Hello', ' Claude'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/llm/anthropic.test.ts
```

Expected: FAIL — `Cannot find module '../../src/llm/anthropic.js'`

- [ ] **Step 3: Implement AnthropicProvider**

```ts
// src/llm/anthropic.ts
import Anthropic from '@anthropic-ai/sdk'
import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'

type AnthropicConfig = {
  apiKey: string
  model: string
}

export class AnthropicProvider implements ILLMProvider {
  readonly name = 'anthropic'
  private client: Anthropic
  private model: string

  constructor(config: AnthropicConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey })
    this.model = config.model
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    // Anthropic separates system messages from the messages array
    const systemMsg = messages.find((m) => m.role === 'system')?.content
    const userMessages = messages.filter((m) => m.role !== 'system')

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: systemMsg,
      messages: userMessages as Anthropic.MessageParam[],
      temperature: options?.temperature,
      top_p: options?.topP,
    })

    const block = response.content[0]
    return block?.type === 'text' ? block.text : ''
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    const systemMsg = messages.find((m) => m.role === 'system')?.content
    const userMessages = messages.filter((m) => m.role !== 'system')

    const stream = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: systemMsg,
      messages: userMessages as Anthropic.MessageParam[],
      stream: true,
      temperature: options?.temperature,
      top_p: options?.topP,
    })

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/llm/anthropic.test.ts
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/llm/anthropic.ts tests/llm/anthropic.test.ts
git commit -m "feat: add AnthropicProvider with chat and chatStream"
```

---

## Task 6: Gemini Adapter

**Files:**
- Create: `src/llm/gemini.ts`
- Create: `tests/llm/gemini.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/llm/gemini.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GeminiProvider } from '../../src/llm/gemini.js'

vi.mock('@google/generative-ai', () => {
  const mockGenerateContent = vi.fn().mockResolvedValue({
    response: { text: () => 'Hello from Gemini' },
  })
  const mockGenerateContentStream = vi.fn().mockResolvedValue({
    stream: (async function* () {
      yield { text: () => 'Hello' }
      yield { text: () => ' Gemini' }
    })(),
  })
  const mockGetGenerativeModel = vi.fn().mockReturnValue({
    generateContent: mockGenerateContent,
    generateContentStream: mockGenerateContentStream,
  })
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
  }
})

describe('GeminiProvider', () => {
  let provider: GeminiProvider

  beforeEach(() => {
    provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-2.0-flash' })
  })

  it('has correct name', () => {
    expect(provider.name).toBe('gemini')
  })

  it('chat returns string response', async () => {
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello from Gemini')
  })

  it('chatStream yields string chunks', async () => {
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['Hello', ' Gemini'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/llm/gemini.test.ts
```

Expected: FAIL — `Cannot find module '../../src/llm/gemini.js'`

- [ ] **Step 3: Implement GeminiProvider**

```ts
// src/llm/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'

type GeminiConfig = {
  apiKey: string
  model: string
}

export class GeminiProvider implements ILLMProvider {
  readonly name = 'gemini'
  private genAI: GoogleGenerativeAI
  private model: string

  constructor(config: GeminiConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey)
    this.model = config.model
  }

  // Gemini uses a flat prompt — concatenate messages
  private buildPrompt(messages: Message[]): string {
    return messages.map((m) => `${m.role}: ${m.content}`).join('\n')
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const geminiModel = this.genAI.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
        topP: options?.topP,
      },
    })
    const result = await geminiModel.generateContent(this.buildPrompt(messages))
    return result.response.text()
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    const geminiModel = this.genAI.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
        topP: options?.topP,
      },
    })
    const result = await geminiModel.generateContentStream(this.buildPrompt(messages))
    for await (const chunk of result.stream) {
      yield chunk.text()
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/llm/gemini.test.ts
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/llm/gemini.ts tests/llm/gemini.test.ts
git commit -m "feat: add GeminiProvider with chat and chatStream"
```

---

## Task 7: Ollama Adapter

**Files:**
- Create: `src/llm/ollama.ts`
- Create: `tests/llm/ollama.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/llm/ollama.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OllamaProvider } from '../../src/llm/ollama.js'

vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(() => ({
    chat: vi.fn().mockResolvedValue({
      message: { content: 'Hello from Ollama' },
    }),
  })),
}))

describe('OllamaProvider', () => {
  let provider: OllamaProvider

  beforeEach(() => {
    provider = new OllamaProvider({ host: 'http://localhost:11434', model: 'llama3.2' })
  })

  it('has correct name', () => {
    expect(provider.name).toBe('ollama')
  })

  it('chat returns string response', async () => {
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello from Ollama')
  })

  it('chatStream delegates to chat (Ollama streaming is same interface)', async () => {
    const chunks: string[] = []
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'hi' }])) {
      chunks.push(chunk)
    }
    expect(chunks.join('')).toBe('Hello from Ollama')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/llm/ollama.test.ts
```

Expected: FAIL — `Cannot find module '../../src/llm/ollama.js'`

- [ ] **Step 3: Implement OllamaProvider**

```ts
// src/llm/ollama.ts
import { Ollama } from 'ollama'
import type { ILLMProvider } from './ILLMProvider.js'
import type { Message, LLMOptions } from './types.js'

type OllamaConfig = {
  host: string   // e.g. 'http://localhost:11434'
  model: string  // e.g. 'llama3.2', 'deepseek-r1'
}

export class OllamaProvider implements ILLMProvider {
  readonly name = 'ollama'
  private client: Ollama
  private model: string

  constructor(config: OllamaConfig) {
    this.client = new Ollama({ host: config.host })
    this.model = config.model
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<string> {
    const response = await this.client.chat({
      model: this.model,
      messages,
      options: {
        temperature: options?.temperature,
        num_predict: options?.maxTokens,
        top_p: options?.topP,
      },
    })
    return response.message.content
  }

  async *chatStream(messages: Message[], options?: LLMOptions): AsyncIterable<string> {
    // Yield the full response as a single chunk (Ollama streaming is optional)
    const result = await this.chat(messages, options)
    yield result
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/llm/ollama.test.ts
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/llm/ollama.ts tests/llm/ollama.test.ts
git commit -m "feat: add OllamaProvider for local model inference"
```

---

## Task 8: DeepSeek Adapter

**Files:**
- Create: `src/llm/deepseek.ts`
- Create: `tests/llm/deepseek.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/llm/deepseek.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeepSeekProvider } from '../../src/llm/deepseek.js'

// DeepSeek is OpenAI-compatible — mock the openai SDK
vi.mock('openai', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'Hello from DeepSeek' } }],
  })
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
  }
})

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider

  beforeEach(() => {
    provider = new DeepSeekProvider({ apiKey: 'test-key', model: 'deepseek-chat' })
  })

  it('has correct name', () => {
    expect(provider.name).toBe('deepseek')
  })

  it('chat returns string response', async () => {
    const result = await provider.chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('Hello from DeepSeek')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/llm/deepseek.test.ts
```

Expected: FAIL — `Cannot find module '../../src/llm/deepseek.js'`

- [ ] **Step 3: Implement DeepSeekProvider**

DeepSeek exposes an OpenAI-compatible API. Reuse `OpenAIProvider` with DeepSeek's base URL.

```ts
// src/llm/deepseek.ts
import { OpenAIProvider } from './openai.js'

type DeepSeekConfig = {
  apiKey: string
  model: string  // e.g. 'deepseek-chat', 'deepseek-reasoner'
}

export class DeepSeekProvider extends OpenAIProvider {
  override readonly name = 'deepseek'

  constructor(config: DeepSeekConfig) {
    super({
      apiKey: config.apiKey,
      model: config.model,
      baseURL: 'https://api.deepseek.com/v1',
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/llm/deepseek.test.ts
```

Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/llm/deepseek.ts tests/llm/deepseek.test.ts
git commit -m "feat: add DeepSeekProvider (OpenAI-compatible adapter)"
```

---

## Task 9: LLM Registry + Config

**Files:**
- Create: `src/llm/registry.ts`
- Create: `src/config/config.ts`
- Create: `tests/llm/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/llm/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { LLMRegistry } from '../../src/llm/registry.js'
import { agentConfig } from '../../src/config/config.js'

beforeEach(() => {
  process.env['OPENAI_API_KEY'] = 'test-openai'
  process.env['ANTHROPIC_API_KEY'] = 'test-anthropic'
  process.env['GEMINI_API_KEY'] = 'test-gemini'
  process.env['DEEPSEEK_API_KEY'] = 'test-deepseek'
})

describe('LLMRegistry', () => {
  it('resolves openai provider for manager', () => {
    const registry = new LLMRegistry(agentConfig)
    const provider = registry.get('manager')
    expect(provider.name).toBe('openai')
  })

  it('resolves anthropic provider for bearResearcher', () => {
    const registry = new LLMRegistry(agentConfig)
    const provider = registry.get('bearResearcher')
    expect(provider.name).toBe('anthropic')
  })

  it('throws for unknown agent', () => {
    const registry = new LLMRegistry(agentConfig)
    expect(() => registry.get('unknownAgent')).toThrow('No LLM config for agent: unknownAgent')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/llm/registry.test.ts
```

Expected: FAIL — `Cannot find module '../../src/llm/registry.js'`

- [ ] **Step 3: Create src/config/config.ts**

```ts
// src/config/config.ts

export type LLMProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'deepseek'

export type AgentLLMConfig = {
  llm: LLMProviderName
  model: string
}

export type AgentConfigMap = Record<string, AgentLLMConfig>

export const agentConfig: AgentConfigMap = {
  bullResearcher:      { llm: 'openai',    model: 'gpt-4o' },
  bearResearcher:      { llm: 'anthropic', model: 'claude-sonnet-4-6' },
  newsAnalyst:         { llm: 'gemini',    model: 'gemini-2.0-flash' },
  fundamentalsAnalyst: { llm: 'deepseek',  model: 'deepseek-chat' },
  riskAnalyst:         { llm: 'gemini',    model: 'gemini-2.0-flash' },
  riskManager:         { llm: 'openai',    model: 'gpt-4o-mini' },
  manager:             { llm: 'openai',    model: 'o3-mini' },
}

export const dataSourceConfig = {
  US: ['yfinance', 'polygon', 'newsapi', 'secedgar'],
  CN: ['tushare', 'akshare'],
  HK: ['akshare'],
} as const
```

- [ ] **Step 4: Create src/llm/registry.ts**

```ts
// src/llm/registry.ts
import type { ILLMProvider } from './ILLMProvider.js'
import type { AgentConfigMap } from '../config/config.js'
import { OpenAIProvider } from './openai.js'
import { AnthropicProvider } from './anthropic.js'
import { GeminiProvider } from './gemini.js'
import { OllamaProvider } from './ollama.js'
import { DeepSeekProvider } from './deepseek.js'

// API keys loaded from environment variables
const providerEnvKeys = {
  openai:    'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini:    'GEMINI_API_KEY',
  ollama:    '',               // no API key — uses host URL
  deepseek:  'DEEPSEEK_API_KEY',
} as const

export class LLMRegistry {
  private cache = new Map<string, ILLMProvider>()

  constructor(private config: AgentConfigMap) {}

  get(agentName: string): ILLMProvider {
    if (this.cache.has(agentName)) return this.cache.get(agentName)!

    const cfg = this.config[agentName]
    if (!cfg) throw new Error(`No LLM config for agent: ${agentName}`)

    const provider = this.createProvider(cfg.llm, cfg.model)
    this.cache.set(agentName, provider)
    return provider
  }

  private createProvider(llm: string, model: string): ILLMProvider {
    const apiKey = (envKey: string) => {
      const key = process.env[envKey]
      if (!key) throw new Error(`Missing environment variable: ${envKey}`)
      return key
    }

    switch (llm) {
      case 'openai':
        return new OpenAIProvider({ apiKey: apiKey('OPENAI_API_KEY'), model })
      case 'anthropic':
        return new AnthropicProvider({ apiKey: apiKey('ANTHROPIC_API_KEY'), model })
      case 'gemini':
        return new GeminiProvider({ apiKey: apiKey('GEMINI_API_KEY'), model })
      case 'ollama':
        return new OllamaProvider({ host: process.env['OLLAMA_HOST'] ?? 'http://localhost:11434', model })
      case 'deepseek':
        return new DeepSeekProvider({ apiKey: apiKey('DEEPSEEK_API_KEY'), model })
      default:
        throw new Error(`Unknown LLM provider: ${llm}`)
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- tests/llm/registry.test.ts
```

Expected: PASS — 3 tests passing.

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: All tests passing. The test sets dummy env vars in `beforeEach` so no real API keys are needed.

- [ ] **Step 7: Commit**

```bash
git add src/llm/registry.ts src/config/config.ts tests/llm/registry.test.ts
git commit -m "feat: add LLMRegistry and agent config — resolves providers by agent name"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass (openai, anthropic, gemini, ollama, deepseek, registry).

- [ ] **Step 2: Type check**

```bash
npm run typecheck
```

Expected: No type errors.

- [ ] **Step 3: Verify git log**

```bash
git log --oneline
```

Expected output (newest first):
```
feat: add LLMRegistry and agent config — resolves providers by agent name
feat: add DeepSeekProvider (OpenAI-compatible adapter)
feat: add OllamaProvider for local model inference
feat: add GeminiProvider with chat and chatStream
feat: add AnthropicProvider with chat and chatStream
feat: add OpenAIProvider with chat and chatStream
feat: add ILLMProvider interface and LLM types
feat: add core domain types (TradingReport, Finding, Decision, etc.)
feat: initialise TypeScript project with Vitest
Add TradingAgent platform design spec
```

---

## What's Next

**Plan 2 — Data & RAG** covers:
- `IDataSource` interface + US market adapters (yfinance, Polygon, NewsAPI, Finnhub, SEC EDGAR)
- CN/HK market adapters (Tushare HTTP, AkShare HTTP)
- `IVectorStore` + `QdrantVectorStore` adapter
- `Embedder` (wraps `ILLMProvider` to produce embeddings)
- `DataFetcher` agent (fetch → chunk → embed → store)
