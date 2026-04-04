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

export type RAGMode = 'qdrant' | 'memory' | 'disabled'

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
  return 'disabled'
}
