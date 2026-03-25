// src/llm/registry.ts
import type { ILLMProvider } from './ILLMProvider.js'
import type { AgentConfigMap } from '../config/config.js'
import { OpenAIProvider } from './openai.js'
import { AnthropicProvider } from './anthropic.js'
import { GeminiProvider } from './gemini.js'
import { OllamaProvider } from './ollama.js'
import { DeepSeekProvider } from './deepseek.js'

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
