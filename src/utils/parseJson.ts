/**
 * Parse a JSON string from LLM output.
 * Strips markdown code fences (```json ... ``` or ``` ... ```) before parsing.
 */
export function parseJson<T>(text: string): T {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n/, '').replace(/\n?```\s*$/, '')
  }
  return JSON.parse(cleaned) as T
}
