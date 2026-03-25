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
