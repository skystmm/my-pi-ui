import type { Memory, MemoryRepository, MemoryScope } from "./repository.js"

export type MemorySelectionInput = {
  projectPath?: string
  sessionId?: string
  prompt: string
  maxItems?: number
  maxChars?: number
}

function terms(text: string): string[] {
  const words: string[] = text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []
  const han = text.match(/[\p{Script=Han}]+/gu) ?? []
  for (const block of han) for (let i = 0; i < block.length - 1; i++) words.push(block.slice(i, i + 2))
  return [...new Set(words)]
}

/** Selects bounded, scope-authorized records; it never mutates persistent memory. */
export async function selectMemories(repo: MemoryRepository, input: MemorySelectionInput): Promise<Memory[]> {
  const scopes: MemoryScope[] = [{ kind: "app" }]
  if (input.projectPath) {
    scopes.push({ kind: "project", projectPath: input.projectPath })
    if (input.sessionId) scopes.push({ kind: "session", projectPath: input.projectPath, sessionId: input.sessionId })
  }
  const query = terms(input.prompt)
  const recent = (await Promise.all(scopes.map(scope => repo.list(scope, { limit: 100 })))).flat()
  const matches = (await Promise.all(query.slice(0, 5).map(text => repo.search({ scopes, text, limit: 20 })))).flat()
  const candidates = [...new Map([...recent, ...matches].map(m => [m.id, m])).values()]
  const rank = (m: Memory) => {
    const content = m.content.toLowerCase()
    const overlap = query.reduce((score, word) => score + (content.includes(word) ? 1 : 0), 0)
    const scope = m.scope.kind === "session" ? 3 : m.scope.kind === "project" ? 2 : 1
    return overlap * 10 + scope
  }
  // Keep a small app preference baseline even when its wording does not match the prompt.
  const appBaseline = new Set(recent.filter(m => m.scope.kind === "app").slice(0, 2).map(m => m.id))
  const app = candidates.filter(m => m.scope.kind === "app" && (appBaseline.has(m.id) || rank(m) >= 11))
    .sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt)
  const relevant = candidates.filter(m => m.scope.kind !== "app" && (query.length === 0 || rank(m) >= 12))
  const ordered = [...app, ...relevant.sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt)]
  const result: Memory[] = []
  let remaining = Math.max(0, Math.floor(input.maxChars ?? 1000))
  const maxItems = Math.max(0, Math.min(20, Math.floor(input.maxItems ?? 6)))
  for (const memory of ordered) {
    if (result.length >= maxItems || remaining === 0) break
    const content = [...memory.content].slice(0, Math.min(400, remaining)).join("")
    if (!content) break
    result.push({ ...memory, content })
    remaining -= [...content].length
  }
  return result
}
