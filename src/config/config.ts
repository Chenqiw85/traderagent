// src/config/config.ts

const usingLLM = 'siliconflow'
const reacherModel = 'deepseek-ai/DeepSeek-V3'
const RiskModel = 'deepseek-ai/DeepSeek-V3'
export type LLMProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'deepseek' | 'siliconflow'

export type AgentLLMConfig = {
  llm: LLMProviderName
  model: string
}

export type AgentConfigMap = Record<string, AgentLLMConfig>

export const agentConfig: AgentConfigMap = {
  // Research team — deepseek-chat: fast, cost-effective for evidence gathering
  bullResearcher:      { llm: usingLLM, model: reacherModel },
  bearResearcher:      { llm: usingLLM, model: reacherModel },
  newsAnalyst:         { llm: usingLLM, model: reacherModel },
  fundamentalsAnalyst: { llm: usingLLM, model: reacherModel },
  // Risk + decision team — deepseek-reasoner (R1): deep chain-of-thought for critical calls
  riskAnalyst:         { llm: usingLLM, model: RiskModel },
  riskManager:         { llm: usingLLM, model: RiskModel },
  manager:             { llm: usingLLM, model: RiskModel },
  // Trader training pipeline — local Ollama defaults for iterative backtesting
  traderPipelineBull:         { llm: 'ollama', model: 'llama3.1' },
  traderPipelineBear:         { llm: 'ollama', model: 'llama3.1' },
  traderPipelineNews:         { llm: 'ollama', model: 'llama3.1' },
  traderPipelineFundamentals: { llm: 'ollama', model: 'llama3.1' },
  traderPipelineRisk:         { llm: 'ollama', model: 'llama3.1' },
  traderPipelineRiskMgr:      { llm: 'ollama', model: 'llama3.1' },
  traderPipelineManager:      { llm: 'ollama', model: 'llama3.1' },
  traderLessonExtractor:      { llm: 'ollama', model: 'llama3.1' },
  // Advisor pipeline — reasoner for synthesis quality
  advisor:              { llm: usingLLM, model: RiskModel },
  marketTrendAnalyzer:  { llm: usingLLM, model: reacherModel },
}

export type AnalystType = 'bull' | 'bear' | 'news' | 'fundamentals'

export const DEFAULT_ANALYSTS: readonly AnalystType[] = ['bull', 'bear', 'news', 'fundamentals']

export type PipelineConfig = {
  /** Which analysts to include in the research stage */
  enabledAnalysts: AnalystType[]
  /** Enable Bull vs Bear debate rounds */
  debateEnabled: boolean
  /** Number of debate rounds (each round = bull rebuttal + bear rebuttal) */
  maxDebateRounds: number
  /** Enable Aggressive/Conservative/Neutral risk debate */
  riskDebateEnabled: boolean
  /** Output language code (e.g. 'en', 'zh', 'ja') */
  outputLanguage: string
  /** RAG mode */
  ragMode: RAGMode
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  enabledAnalysts: [...DEFAULT_ANALYSTS],
  debateEnabled: false,
  maxDebateRounds: 2,
  riskDebateEnabled: false,
  outputLanguage: process.env['OUTPUT_LANGUAGE'] ?? 'en',
  ragMode: 'disabled',
}

export type RAGMode = 'qdrant' | 'memory' | 'bm25' | 'disabled'

/** Embedding model → vector dimension mapping */
export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'nomic-embed-text': 768,
}

export function getEmbeddingDimension(model: string): number {
  return EMBEDDING_DIMENSIONS[model] ?? 1536
}

export function detectRAGMode(): RAGMode {
  if (process.env['OPENAI_API_KEY'] && process.env['QDRANT_URL']) return 'qdrant'
  if (process.env['OLLAMA_HOST']) return 'memory'
  if (process.env['RAG_BM25'] === 'true') return 'bm25'
  return 'disabled'
}
