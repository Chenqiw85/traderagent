import { describe, it, expect, afterEach } from 'vitest'
import { setOutputLanguage, getOutputLanguage, getLanguageInstruction, withLanguage } from '../../src/utils/i18n.js'

describe('i18n', () => {
  afterEach(() => {
    setOutputLanguage('en')
  })

  it('defaults to English', () => {
    expect(getOutputLanguage()).toBe('en')
  })

  it('returns empty instruction for English', () => {
    setOutputLanguage('en')
    expect(getLanguageInstruction()).toBe('')
  })

  it('returns Chinese instruction', () => {
    setOutputLanguage('zh')
    expect(getLanguageInstruction()).toBe('用中文回答。')
  })

  it('returns generic instruction for unknown language', () => {
    setOutputLanguage('fr')
    expect(getLanguageInstruction()).toBe('Respond in fr.')
  })

  it('withLanguage appends instruction for non-English', () => {
    setOutputLanguage('zh')
    const result = withLanguage('You are an analyst.')
    expect(result).toBe('You are an analyst.\n\n用中文回答。')
  })

  it('withLanguage returns unchanged prompt for English', () => {
    setOutputLanguage('en')
    const result = withLanguage('You are an analyst.')
    expect(result).toBe('You are an analyst.')
  })
})
