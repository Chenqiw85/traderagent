import { FinnhubSource } from '../data/finnhub.js'
import { YFinanceSource } from '../data/yfinance.js'
import { FallbackDataSource } from '../data/FallbackDataSource.js'
import { RateLimitedDataSource } from '../data/RateLimitedDataSource.js'
import { rateLimitDefaults } from '../config/rateLimits.js'
import { PostgresDataSource } from '../db/PostgresDataSource.js'
import { QdrantVectorStore } from '../rag/qdrant.js'
import { BM25VectorStore } from '../rag/BM25VectorStore.js'
import { Embedder } from '../rag/embedder.js'
import { detectRAGMode, getEmbeddingDimension, type RAGMode } from '../config/config.js'
import type { IDataSource } from '../data/IDataSource.js'
import type { IEmbedder } from '../rag/IEmbedder.js'
import type { IVectorStore } from '../rag/IVectorStore.js'

type RAGDeps = {
  ragMode: RAGMode
  vectorStore?: IVectorStore
  embedder?: IEmbedder
}

export function buildDataSourceChain(chainName: string): FallbackDataSource {
  const dataSources: IDataSource[] = []

  if (process.env['DATABASE_URL']) {
    dataSources.push(new PostgresDataSource())
  }

  if (process.env['FINNHUB_API_KEY']) {
    dataSources.push(new RateLimitedDataSource(new FinnhubSource(), rateLimitDefaults['finnhub']))
  }

  dataSources.push(new RateLimitedDataSource(new YFinanceSource(), rateLimitDefaults['yfinance']))

  return new FallbackDataSource(chainName, dataSources)
}

export function buildRAGDeps(): RAGDeps {
  const ragMode = detectRAGMode()
  let vectorStore: IVectorStore | undefined
  let embedder: IEmbedder | undefined

  if (ragMode === 'qdrant') {
    const qdrantUrl = process.env['QDRANT_URL']
    const openaiKey = process.env['OPENAI_API_KEY']
    if (!qdrantUrl || !openaiKey) {
      throw new Error('QDRANT_URL and OPENAI_API_KEY are required for qdrant RAG mode')
    }
    const embeddingModel = 'text-embedding-3-small'
    vectorStore = new QdrantVectorStore({
      url: qdrantUrl,
      apiKey: process.env['QDRANT_API_KEY'],
      collectionName: 'traderagent',
      vectorSize: getEmbeddingDimension(embeddingModel),
    })
    embedder = new Embedder({ apiKey: openaiKey, model: embeddingModel })
  } else if (ragMode === 'memory') {
    vectorStore = new BM25VectorStore()
  }

  return { ragMode, vectorStore, embedder }
}
