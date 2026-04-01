// src/config/config.ts

export type LLMProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'deepseek'

export type AgentLLMConfig = {
  llm: LLMProviderName
  model: string
}

export type AgentConfigMap = Record<string, AgentLLMConfig>

export const agentConfig: AgentConfigMap = {
  // Research team — deepseek-chat: fast, cost-effective for evidence gathering
  bullResearcher:      { llm: 'deepseek', model: 'deepseek-chat' },
  bearResearcher:      { llm: 'deepseek', model: 'deepseek-chat' },
  newsAnalyst:         { llm: 'deepseek', model: 'deepseek-chat' },
  fundamentalsAnalyst: { llm: 'deepseek', model: 'deepseek-chat' },
  // Risk + decision team — deepseek-reasoner (R1): deep chain-of-thought for critical calls
  riskAnalyst:         { llm: 'deepseek', model: 'deepseek-reasoner' },
  riskManager:         { llm: 'deepseek', model: 'deepseek-reasoner' },
  manager:             { llm: 'deepseek', model: 'deepseek-reasoner' },
  // Trader training pipeline — local Ollama defaults for iterative backtesting
  traderPipelineBull:         { llm: 'ollama', model: 'llama3.1' },
  traderPipelineBear:         { llm: 'ollama', model: 'llama3.1' },
  traderPipelineNews:         { llm: 'ollama', model: 'llama3.1' },
  traderPipelineFundamentals: { llm: 'ollama', model: 'llama3.1' },
  traderPipelineRisk:         { llm: 'ollama', model: 'llama3.1' },
  traderPipelineRiskMgr:      { llm: 'ollama', model: 'llama3.1' },
  traderPipelineManager:      { llm: 'ollama', model: 'llama3.1' },
  traderLessonExtractor:      { llm: 'ollama', model: 'llama3.1' },
}

export const dataSourceConfig = {
  US: ['yfinance', 'polygon', 'newsapi', 'secedgar'],
  CN: ['tushare', 'akshare'],
  HK: ['akshare'],
} as const

export type RAGMode = 'qdrant' | 'memory' | 'disabled'

export function detectRAGMode(): RAGMode {
  if (process.env['OPENAI_API_KEY'] && process.env['QDRANT_URL']) return 'qdrant'
  if (process.env['OLLAMA_HOST']) return 'memory'
  return 'disabled'
}
