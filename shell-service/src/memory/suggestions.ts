import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { getAgentDir } from "../paths.js"
import { mutateJsonFile, readJsonFile } from "../atomic-write.js"
import type { MemoryScope } from "./repository.js"
import { readMemorySettings } from "./settings.js"

export type MemorySuggestion = {
  id: string
  content: string
  scope: MemoryScope
  state: "pending" | "accepted" | "rejected"
  evidence: { projectPath: string; sessionId: string }[]
  createdAt: number
}
type Observation = { fingerprint: string; content: string; projectPath: string; sessionId: string }
type Index = { version: 1; observations: Observation[]; suggestions: (MemorySuggestion & { fingerprint: string })[] }
const empty = (): Index => ({ version: 1, observations: [], suggestions: [] })
const path = () => join(getAgentDir(), "pi-ui", "memory-suggestions.json")
const pendingTurns = new Map<string, { prompt: string; sessionId: string }>()

export function rememberPreferenceTurn(projectPath: string, sessionId: string, prompt: string): void {
  if (sessionId && prompt) pendingTurns.set(projectPath, { prompt, sessionId })
}
export function discardPreferenceTurn(projectPath: string): void { pendingTurns.delete(projectPath) }

export async function settlePreferenceTurn(projectPath: string): Promise<MemorySuggestion | null> {
  const turn = pendingTurns.get(projectPath)
  pendingTurns.delete(projectPath)
  if (!turn || !readMemorySettings().suggestEnabled) return null
  return observePreference(turn.prompt, projectPath, turn.sessionId)
}
const read = (): Index => {
  const value = readJsonFile<Index>(path())
  return value?.version === 1 && Array.isArray(value.observations) && Array.isArray(value.suggestions) ? value : empty()
}

function candidate(prompt: string): { content: string; fingerprint: string; explicit: boolean; global: boolean } | null {
  const text = prompt.trim()
  if (!text || text.length > 500 || text.includes("```") || /(?:api.?key|token|密码|密钥|私钥|sk-[a-z0-9]{12})/i.test(text)) return null
  const explicit = /^(?:以后|今后|从现在起|始终|总是)/.test(text)
  if (!explicit && !/^(?:我(?:更)?喜欢|我(?:更)?偏好|i prefer\b|please always\b)/i.test(text)) return null
  const content = text.split(/[。！？!?\n]/, 1)[0].slice(0, 180).trim()
  if (content.length < 6) return null
  const fingerprint = content.toLocaleLowerCase().replace(/[\s，,。.!！?？:：]/g, "")
  return { content, fingerprint, explicit, global: /(?:所有项目|全部项目|任何项目|每个项目|all projects)/i.test(content) }
}

/** Observes user-authored text only; suggestions never enter MemoryRepository without confirmation. */
export async function observePreference(prompt: string, projectPath: string, sessionId: string): Promise<MemorySuggestion | null> {
  const found = candidate(prompt)
  if (!found || !projectPath || !sessionId) return null
  let surfaced: MemorySuggestion | null = null
  await mutateJsonFile<Index>(path(), raw => {
    const cur = raw?.version === 1 && Array.isArray(raw.observations) && Array.isArray(raw.suggestions) ? raw : empty()
    if (cur.suggestions.some(s => s.fingerprint === found.fingerprint && s.state !== "pending")) return cur
    const observations = cur.observations.some(o => o.fingerprint === found.fingerprint && o.projectPath === projectPath && o.sessionId === sessionId)
      ? cur.observations
      : [...cur.observations, { fingerprint: found.fingerprint, content: found.content, projectPath, sessionId }].slice(-500)
    const evidence = observations.filter(o => o.fingerprint === found.fingerprint).map(o => ({ projectPath: o.projectPath, sessionId: o.sessionId }))
    const projectCount = new Set(evidence.map(e => e.projectPath)).size
    const sessionCount = new Set(evidence.map(e => `${e.projectPath}\0${e.sessionId}`)).size
    const scope: MemoryScope | null = found.global || projectCount >= 2 ? { kind: "app" }
      : found.explicit || sessionCount >= 2 ? { kind: "project", projectPath } : null
    if (!scope) return { ...cur, observations }
    const existing = cur.suggestions.find(s => s.fingerprint === found.fingerprint && s.state === "pending")
    if (existing) {
      if (existing.scope.kind === "app" || scope.kind !== "app") return { ...cur, observations }
      const updated = { ...existing, scope, evidence }
      surfaced = updated
      return { ...cur, observations, suggestions: cur.suggestions.map(s => s.id === existing.id ? updated : s) }
    }
    const suggestion = { id: randomUUID(), fingerprint: found.fingerprint, content: found.content, scope, state: "pending" as const, evidence, createdAt: Date.now() }
    surfaced = suggestion
    return { ...cur, observations, suggestions: [...cur.suggestions, suggestion].slice(-500) }
  }, empty())
  return surfaced
}

export function listSuggestions(projectPath?: string): MemorySuggestion[] {
  return read().suggestions.filter(s => s.state === "pending" && (s.scope.kind === "app" || s.scope.projectPath === projectPath))
    .map(({ fingerprint: _fingerprint, ...suggestion }) => suggestion)
}

export async function resolveSuggestion(id: string, state: "accepted" | "rejected"): Promise<MemorySuggestion | null> {
  let resolved: MemorySuggestion | null = null
  await mutateJsonFile<Index>(path(), raw => {
    const cur = raw?.version === 1 && Array.isArray(raw.observations) && Array.isArray(raw.suggestions) ? raw : empty()
    const prior = cur.suggestions.find(s => s.id === id && s.state === "pending")
    if (!prior) return cur
    const next = { ...prior, state }
    resolved = next
    return { ...cur, suggestions: cur.suggestions.map(s => s.id === id ? next : s) }
  }, empty())
  return resolved
}
