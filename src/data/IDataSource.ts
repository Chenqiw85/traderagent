// src/data/IDataSource.ts

import type { DataQuery, DataResult } from '../agents/base/types.js'

export interface IDataSource {
  readonly name: string
  fetch(query: DataQuery): Promise<DataResult>
}
