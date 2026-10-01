/** Persistent memories are records. Selecting them for an LLM turn is a separate concern. */
export type MemoryScope =
  | { kind: "app" }
  | { kind: "project"; projectPath: string }
  | { kind: "session"; projectPath: string; sessionId: string }

export type Memory = {
  id: string
  scope: MemoryScope
  content: string
  source: string
  revision: number
  createdAt: number
  updatedAt: number
}

export type MemoryRevision = Memory & { action: "create" | "update" | "delete" }

export type MemorySearch = {
  scopes: readonly MemoryScope[]
  text: string
  limit?: number
}

/** Every method is scope-bound, including reads by ID. Implementations own durability and indexing. */
export interface MemoryRepository {
  create(input: { scope: MemoryScope; content: string; source?: string }): Promise<Memory>
  get(scope: MemoryScope, id: string): Promise<Memory | null>
  list(scope: MemoryScope, options?: { limit?: number; offset?: number }): Promise<Memory[]>
  search(input: MemorySearch): Promise<Memory[]>
  update(scope: MemoryScope, id: string, expectedRevision: number, content: string): Promise<Memory | null>
  delete(scope: MemoryScope, id: string, expectedRevision: number): Promise<boolean>
  history(scope: MemoryScope, id: string): Promise<MemoryRevision[]>
  close(): Promise<void>
}

export class MemoryConflictError extends Error {
  constructor() { super("memory revision conflict") }
}
