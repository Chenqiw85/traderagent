// src/agents/data/DataFetcher.ts

import type { IAgent } from '../base/IAgent.js'
import type { AgentRole, DataQuery, DataResult, DataType, Market, TradingReport } from '../base/types.js'
import { DATA_CRITICALITY } from '../base/types.js'
import type { IDataSource } from '../../data/IDataSource.js'
import type { IVectorStore, Document } from '../../rag/IVectorStore.js'
import type { IEmbedder } from '../../rag/IEmbedder.js'
import { chunkText, type ChunkOptions } from '../../rag/chunker.js'
import crypto from 'node:crypto'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('data-fetcher')

type DataFetcherConfig = {
  dataSources: IDataSource[]
  vectorStore?: IVectorStore
  embedder?: IEmbedder
  chunkOptions?: ChunkOptions
}

/**
 * DataFetcher agent — the first stage of the pipeline.
 * 1. Fetches data from all configured data sources for the given ticker
 * 2. Chunks the raw text data
 * 3. Embeds each chunk
 * 4. Upserts into the vector store
 * 5. Writes raw DataResults to the TradingReport
 */
export class DataFetcher implements IAgent {
  readonly name = 'dataFetcher'
  readonly role: AgentRole = 'data'

  private dataSources: IDataSource[]
  private vectorStore?: IVectorStore
  private embedder?: IEmbedder
  private chunkOptions: ChunkOptions

  constructor(config: DataFetcherConfig) {
    this.dataSources = config.dataSources
    this.vectorStore = config.vectorStore
    this.embedder = config.embedder
    this.chunkOptions = config.chunkOptions ?? { chunkSize: 1000, overlap: 200 }
  }

  async run(report: TradingReport): Promise<TradingReport> {
    const { ticker, market } = report
    const asOf = report.timestamp

    // 1. Fetch from all data sources in parallel
    const dataTypes: DataType[] = ['ohlcv', 'news', 'fundamentals', 'technicals']
    const fetchPromises: Promise<DataResult | null>[] = []

    for (const source of this.dataSources) {
      for (const type of dataTypes) {
        const lookbackDays = type === 'news' ? 7 : 365
        const query: DataQuery = {
          ticker,
          market,
          type,
          from: new Date(asOf.getTime() - lookbackDays * 24 * 60 * 60 * 1000),
          to: asOf,
        }
        fetchPromises.push(
          source.fetch(query).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err)
            log.warn({ source: source.name, type, error: msg }, 'Data fetch failed')
            return null
          }),
        )
      }
    }

    const results = await Promise.all(fetchPromises)
    const validResults = results.filter((r): r is DataResult => r !== null)

    // 1b. Enforce data criticality — abort if any critical type has zero results
    const fetchedTypes = new Set(validResults.map((r) => r.type))
    const missingCritical = dataTypes.filter(
      (t) => DATA_CRITICALITY[t] === 'critical' && !fetchedTypes.has(t),
    )
    if (missingCritical.length > 0) {
      throw new Error(
        `ABORT: Failed to fetch critical data types for ${ticker}: ${missingCritical.join(', ')}. ` +
        `Pipeline cannot continue without this data.`,
      )
    }

    // 2. Chunk + embed + store (if vector store and embedder are configured)
    if (this.vectorStore && this.embedder) {
      const docs: Document[] = []

      for (const result of validResults) {
        const text = this.serializeData(result)
        if (!text) continue

        const chunks = chunkText(text, this.chunkOptions)
        const texts = chunks.map((c) => c.text)

        if (texts.length === 0) continue

        const embeddings = await this.embedder.embedBatch(texts)

        for (let i = 0; i < chunks.length; i++) {
          docs.push({
            id: crypto.randomUUID(),
            content: chunks[i].text,
            embedding: embeddings[i],
            metadata: {
              ticker,
              market,
              source: `datasource-${result.ticker}`,
              type: result.type,
              chunkIndex: chunks[i].index,
              fetchedAt: result.fetchedAt.toISOString(),
            },
          })
        }
      }

      if (docs.length > 0) {
        await this.vectorStore.upsert(docs)
      }
    }

    // 3. Write raw data to TradingReport
    return {
      ...report,
      rawData: [...report.rawData, ...validResults],
    }
  }

  /** Convert DataResult.data to a string for chunking */
  private serializeData(result: DataResult): string {
    if (typeof result.data === 'string') return result.data
    try {
      return JSON.stringify(result.data, null, 2)
    } catch {
      return ''
    }
  }
}
