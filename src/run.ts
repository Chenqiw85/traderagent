// src/run.ts — entry point for running a single stock analysis
// Usage: npx tsx src/run.ts AAPL US

import { Orchestrator } from './orchestrator/Orchestrator.js'
import { DataFetcher } from './agents/data/DataFetcher.js'
import { TechnicalAnalyzer } from './agents/analyzer/TechnicalAnalyzer.js'
import { BullResearcher } from './agents/researcher/BullResearcher.js'
import { BearResearcher } from './agents/researcher/BearResearcher.js'
import { NewsAnalyst } from './agents/researcher/NewsAnalyst.js'
import { FundamentalsAnalyst } from './agents/researcher/FundamentalsAnalyst.js'
import { RiskAnalyst } from './agents/risk/RiskAnalyst.js'
import { RiskManager } from './agents/risk/RiskManager.js'
import { Manager } from './agents/manager/Manager.js'
import { LLMRegistry } from './llm/registry.js'
import { FinnhubSource } from './data/finnhub.js'
import { YFinanceSource } from './data/yfinance.js'
import { FallbackDataSource } from './data/FallbackDataSource.js'
import { PostgresDataSource } from './db/PostgresDataSource.js'
import { QdrantVectorStore } from './rag/qdrant.js'
import { InMemoryVectorStore } from './rag/InMemoryVectorStore.js'
import { Embedder } from './rag/embedder.js'
import { OllamaEmbedder } from './rag/OllamaEmbedder.js'
import { agentConfig, detectRAGMode } from './config/config.js'
import type { Market } from './agents/base/types.js'
const ticker = process.argv[2] ?? 'AAPL'
const market = (process.argv[3] ?? 'US') as Market

console.log(`\nAnalyzing ${ticker} on ${market} market...\n`)

// --- Data source fallback chain ---
const dataSources = []

// Try Postgres first (local DB cache)
if (process.env['DATABASE_URL']) {
  dataSources.push(new PostgresDataSource())
}

// API fallbacks
if (process.env['FINNHUB_API_KEY']) {
  dataSources.push(new FinnhubSource())
}
dataSources.push(new YFinanceSource())

const fallbackSource = new FallbackDataSource('price-chain', dataSources)

// --- RAG mode auto-detection ---
const ragMode = detectRAGMode()
import type { IVectorStore } from './rag/IVectorStore.js'
import type { IEmbedder } from './rag/IEmbedder.js'

let vectorStore: IVectorStore | undefined
let embedder: IEmbedder | undefined

if (ragMode === 'qdrant') {
  console.log('[RAG] Full mode: Qdrant + OpenAI embeddings')
  vectorStore = new QdrantVectorStore({
    url: process.env['QDRANT_URL']!,
    collectionName: 'traderagent',
    vectorSize: 1536, // text-embedding-3-small dimension
  })
  embedder = new Embedder({ apiKey: process.env['OPENAI_API_KEY']! })
} else if (ragMode === 'memory') {
  console.log('[RAG] In-memory mode: local store + Ollama embeddings')
  vectorStore = new InMemoryVectorStore()
  embedder = new OllamaEmbedder({ model: 'nomic-embed-text' })
} else {
  console.log('[RAG] Disabled — set OPENAI_API_KEY+QDRANT_URL or OLLAMA_HOST to enable')
}

// --- Build pipeline ---
const registry = new LLMRegistry(agentConfig)

const researcherConfig = { vectorStore, embedder }

const orchestrator = new Orchestrator({
  dataFetcher: new DataFetcher({
    dataSources: [fallbackSource],
    vectorStore,
    embedder,
  }),
  technicalAnalyzer: new TechnicalAnalyzer({ dataSource: fallbackSource }),
  researcherTeam: [
    new BullResearcher({ llm: registry.get('bullResearcher'), ...researcherConfig }),
    new BearResearcher({ llm: registry.get('bearResearcher'), ...researcherConfig }),
    new NewsAnalyst({ llm: registry.get('newsAnalyst'), ...researcherConfig }),
    new FundamentalsAnalyst({ llm: registry.get('fundamentalsAnalyst'), ...researcherConfig }),
  ],
  riskTeam: [
    new RiskAnalyst({ llm: registry.get('riskAnalyst') }),
    new RiskManager({ llm: registry.get('riskManager') }),
  ],
  manager: new Manager({ llm: registry.get('manager') }),
})

try {
  const report = await orchestrator.run(ticker, market)

  console.log('='.repeat(60))
  console.log(`FINAL DECISION: ${report.ticker} (${report.market})`)
  console.log('='.repeat(60))

  if (report.finalDecision) {
    const d = report.finalDecision
    console.log(`Action:      ${d.action}`)
    console.log(`Confidence:  ${(d.confidence * 100).toFixed(0)}%`)
    console.log(`Reasoning:   ${d.reasoning}`)
    if (d.suggestedPositionSize != null)
      console.log(`Position:    ${(d.suggestedPositionSize * 100).toFixed(1)}% of portfolio`)
    if (d.stopLoss != null) console.log(`Stop loss:   $${d.stopLoss}`)
    if (d.takeProfit != null) console.log(`Take profit: $${d.takeProfit}`)
  } else {
    console.log('No decision produced.')
  }

  if (report.computedIndicators) {
    const ci = report.computedIndicators
    console.log('\nComputed Indicators:')
    console.log(`  RSI: ${ci.momentum.rsi.toFixed(1)} | MACD: ${ci.trend.macd.line.toFixed(2)} | Beta: ${ci.risk.beta.toFixed(2)}`)
    console.log(`  Volatility: ${(ci.volatility.historicalVolatility * 100).toFixed(1)}% | MaxDD: ${(ci.risk.maxDrawdown * 100).toFixed(1)}% | VaR95: ${(ci.risk.var95 * 100).toFixed(2)}%`)
  }

  console.log('\nResearch findings:')
  for (const f of report.researchFindings) {
    console.log(`  [${f.agentName}] ${f.stance} (${(f.confidence * 100).toFixed(0)}%) — ${f.evidence.slice(0, 2).join('; ')}`)
  }

  if (report.riskAssessment) {
    const ra = report.riskAssessment
    console.log(`\nRisk: ${ra.riskLevel} | VaR: ${(ra.metrics.VaR * 100).toFixed(2)}% | Volatility: ${(ra.metrics.volatility * 100).toFixed(1)}%`)
  }
} catch (err) {
  console.error(`\nPIPELINE FAILED: ${(err as Error).message}`)
  process.exit(1)
}
