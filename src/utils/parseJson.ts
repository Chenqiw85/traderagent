/**
 * Parse a JSON string from LLM output.
 * Strips markdown code fences (```json ... ``` or ``` ... ```) before parsing.
 * Enforces a size limit to prevent DoS from oversized LLM responses.
 */
const MAX_LLM_RESPONSE_BYTES = 512_000 // 512 KB

export function parseJson<T>(text: string): T {
  if (text.length > MAX_LLM_RESPONSE_BYTES) {
    throw new Error(`LLM response too large to parse: ${text.length} bytes`)
  }
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n/, '').replace(/\n?```\s*$/, '')
  }
  // Fallback: extract first JSON object or array from the response
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (match) {
      cleaned = match[1]
    }
  }
  return JSON.parse(cleaned) as T
}
