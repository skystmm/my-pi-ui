import type { SessionEntry } from "./ws-protocol"

export type SessionTreeRow = { entry: SessionEntry; depth: number; active: boolean; childCount: number }

function activePath(entries: SessionEntry[], leafId: string): Set<string> {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const active = new Set<string>()
  let id: string | null = leafId
  while (id && byId.has(id) && !active.has(id)) {
    active.add(id)
    id = byId.get(id)?.parentId ?? null
  }
  return active
}

export function buildSessionTreeRows(entries: SessionEntry[], leafId: string): SessionTreeRow[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const children = new Map<string, SessionEntry[]>()
  const roots: SessionEntry[] = []
  for (const entry of entries) {
    if (!entry.parentId || entry.parentId === entry.id || !byId.has(entry.parentId)) roots.push(entry)
    else children.set(entry.parentId, [...(children.get(entry.parentId) ?? []), entry])
  }
  const active = activePath(entries, leafId)
  const rows: SessionTreeRow[] = []
  const visited = new Set<string>()
  const walk = (start: SessionEntry) => {
    const pending = [{ entry: start, depth: 0 }]
    while (pending.length) {
      const { entry, depth } = pending.pop()!
      if (visited.has(entry.id)) continue
      visited.add(entry.id)
      const descendants = children.get(entry.id) ?? []
      rows.push({ entry, depth, active: active.has(entry.id), childCount: descendants.length })
      for (let i = descendants.length - 1; i >= 0; i--) pending.push({ entry: descendants[i], depth: depth + 1 })
    }
  }
  for (const root of roots) walk(root)
  for (const entry of entries) if (!visited.has(entry.id)) walk(entry)
  return rows
}

/** Pi RPC fork requires a user message id; it forks before that prompt. */
export function lastForkableUserEntryId(entries: SessionEntry[], leafId: string): string | null {
  const active = activePath(entries, leafId)
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (active.has(entry.id) && entry.type === "message" && entry.message.role === "user") return entry.id
  }
  return null
}
