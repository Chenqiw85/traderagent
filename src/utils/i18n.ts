// src/utils/i18n.ts

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  en: 'Respond in English.',
  zh: '用中文回答。',
  'zh-TW': '用繁體中文回答。',
  ja: '日本語で回答してください。',
  ko: '한국어로 응답하세요.',
}

let currentLanguage = process.env['OUTPUT_LANGUAGE'] ?? 'en'

export function setOutputLanguage(lang: string): void {
  currentLanguage = lang
}

export function getOutputLanguage(): string {
  return currentLanguage
}

/**
 * Returns a language instruction string to append to LLM system prompts.
 * Returns empty string if language is 'en' (default).
 */
export function getLanguageInstruction(): string {
  if (currentLanguage === 'en') return ''
  return LANGUAGE_INSTRUCTIONS[currentLanguage] ?? `Respond in ${currentLanguage}.`
}

/**
 * Appends language instruction to a system prompt if non-English output is configured.
 */
export function withLanguage(systemPrompt: string): string {
  const instruction = getLanguageInstruction()
  if (!instruction) return systemPrompt
  return `${systemPrompt}\n\n${instruction}`
}
