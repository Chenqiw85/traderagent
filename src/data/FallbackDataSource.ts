import type { IDataSource } from './IDataSource.js'
import type { DataQuery, DataResult } from '../agents/base/types.js'

export class FallbackDataSource implements IDataSource {
  readonly name: string
  private sources: IDataSource[]

  constructor(name: string, sources: IDataSource[]) {
    this.name = name
    this.sources = sources
  }

  async fetch(query: DataQuery): Promise<DataResult> {
    const errors: { source: string; error: string }[] = []

    for (const source of this.sources) {
      try {
        const result = await source.fetch(query)
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[${this.name}] ${source.name}/${query.type} failed: ${message}`)
        errors.push({ source: source.name, error: message })
      }
    }

    const details = errors.map((e) => `${e.source}: ${e.error}`).join(', ')
    throw new Error(`All sources failed for ${query.type} (${query.ticker}): ${details}`)
  }
}
