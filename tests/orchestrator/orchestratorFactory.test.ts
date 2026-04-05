import { describe, expect, it, vi } from 'vitest'
import { resolveLLMMap } from '../../src/orchestrator/OrchestratorFactory.js'
import type { ILLMProvider } from '../../src/llm/ILLMProvider.js'

function makeProvider(name: string): ILLMProvider {
  return {
    name,
    chat: vi.fn(),
    chatStream: vi.fn() as unknown as ILLMProvider['chatStream'],
  }
}

describe('resolveLLMMap', () => {
  it('maps default CLI agent names to factory slots', () => {
    const get = vi.fn((name: string) => makeProvider(name))

    const llms = resolveLLMMap(get, 'default')

    expect(get).toHaveBeenCalledWith('bullResearcher')
    expect(get).toHaveBeenCalledWith('bearResearcher')
    expect(get).toHaveBeenCalledWith('newsAnalyst')
    expect(get).toHaveBeenCalledWith('fundamentalsAnalyst')
    expect(get).toHaveBeenCalledWith('tradePlanner')
    expect(get).toHaveBeenCalledWith('riskAnalyst')
    expect(get).toHaveBeenCalledWith('riskManager')
    expect(get).toHaveBeenCalledWith('manager')
    expect(llms.bull.name).toBe('bullResearcher')
    expect(llms.tradePlanner.name).toBe('tradePlanner')
    expect(llms.manager.name).toBe('manager')
  })

  it('maps trader pipeline agent names to factory slots', () => {
    const get = vi.fn((name: string) => makeProvider(name))

    const llms = resolveLLMMap(get, 'trader')

    expect(get).toHaveBeenCalledWith('traderPipelineBull')
    expect(get).toHaveBeenCalledWith('traderPipelineBear')
    expect(get).toHaveBeenCalledWith('traderPipelineNews')
    expect(get).toHaveBeenCalledWith('traderPipelineFundamentals')
    expect(get).toHaveBeenCalledWith('traderPipelineManager')
    expect(get).toHaveBeenCalledWith('traderPipelineRisk')
    expect(get).toHaveBeenCalledWith('traderPipelineRiskMgr')
    expect(get).toHaveBeenCalledWith('traderPipelineManager')
    expect(llms.bull.name).toBe('traderPipelineBull')
    expect(llms.tradePlanner.name).toBe('traderPipelineManager')
    expect(llms.manager.name).toBe('traderPipelineManager')
  })
})
