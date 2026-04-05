import type { IVectorStore, Document } from '../../rag/IVectorStore.js'
import type { IEmbedder } from '../../rag/IEmbedder.js'
import type { LessonEntry } from './types.js'
import { createLogger } from '../../utils/logger.js'

const log = createLogger('lessons-journal')

type JournalConfig = {
  vectorStore?: IVectorStore
  embedder?: IEmbedder
}

export class LessonsJournal {
  private readonly vectorStore?: IVectorStore
  private readonly embedder?: IEmbedder

  constructor(config: JournalConfig) {
    this.vectorStore = config.vectorStore
    this.embedder = config.embedder
  }

  async store(lessons: LessonEntry[]): Promise<void> {
    if (!this.vectorStore || !this.embedder || lessons.length === 0) return

    const texts = lessons.map((lesson) => this.buildContent(lesson))
    const embeddings = await this.embedder.embedBatch(texts)

    if (embeddings.length !== texts.length) {
      log.error({ expected: texts.length, got: embeddings.length }, 'Embedding count mismatch')
      return
    }

    const docs: Document[] = lessons.map((lesson, index) => ({
      id: lesson.id,
      content: texts[index] ?? '',
      embedding: embeddings[index]!,
      metadata: {
        type: 'lesson',
        ticker: lesson.ticker,
        market: lesson.market,
        passNumber: lesson.passNumber,
        confidence: lesson.confidence,
      },
    }))

    await this.vectorStore.upsert(docs)
  }

  async retrieve(query: string, ticker: string, topK: number): Promise<string[]> {
    if (!this.vectorStore || !this.embedder) return []

    const embedding = await this.embedder.embed(query)
    const docs = await this.vectorStore.search(embedding, topK, {
      must: [{ ticker }, { type: 'lesson' }],
    })

    return docs.map((doc) => doc.content)
  }

  private buildContent(lesson: LessonEntry): string {
    return [
      `Condition: ${lesson.condition}`,
      `Lesson: ${lesson.lesson}`,
      `Evidence: ${lesson.evidence}`,
      `Confidence: ${lesson.confidence}`,
    ].join('\n')
  }
}
