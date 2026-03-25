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
