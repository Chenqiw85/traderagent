// src/rag/PerAgentMemoryStore.ts

import { BM25VectorStore } from './BM25VectorStore.js'
import type { IVectorStore } from './IVectorStore.js'

export type AgentPerspective = 'bull' | 'bear' | 'trader' | 'research_manager' | 'portfolio_manager'

const ALL_PERSPECTIVES: readonly AgentPerspective[] = [
  'bull', 'bear', 'trader', 'research_manager', 'portfolio_manager',
] as const

/**
 * Manages isolated BM25VectorStore instances per agent perspective.
 * Each perspective gets its own store so lessons from one agent type
 * (e.g. bull researcher) don't contaminate another's (e.g. bear researcher).
 */
export class PerAgentMemoryStore {
  private readonly stores = new Map<AgentPerspective, BM25VectorStore>()

  /** Returns (or lazily creates) the store for the given perspective. */
  getStore(perspective: AgentPerspective): IVectorStore {
    let store = this.stores.get(perspective)
    if (!store) {
      store = new BM25VectorStore()
      this.stores.set(perspective, store)
    }
    return store
  }

  /** Returns all perspective keys that currently have a store. */
  get perspectives(): AgentPerspective[] {
    return [...this.stores.keys()]
  }

  /** All valid perspectives. */
  static readonly ALL: readonly AgentPerspective[] = ALL_PERSPECTIVES
}
