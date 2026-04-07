// src/prompts/tickerPreservation.ts

/**
 * Returns a standardised instruction block that tells the LLM to preserve
 * the exact ticker symbol — including any exchange suffix — throughout its
 * entire response.
 */
export function tickerPreservationInstruction(ticker: string): string {
  return `IMPORTANT — Instrument: The instrument to analyze is \`${ticker}\`. Use this exact ticker in every tool call, data reference, report, and recommendation. Never strip, alter, or normalize any exchange suffix (e.g. .HK, .TO, .L, .T, .SS, .SZ).`
}
