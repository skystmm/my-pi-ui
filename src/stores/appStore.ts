import { useSyncExternalStore, useCallback } from "react"
import { wsClient } from "../lib/ws-client"
import type { ProjectMeta, SessionMeta, ProviderAccount, ModelEntry, Entry, ShellEvent, ExtensionEntry, SkillEntry, SessionStats, StreamDelta } from "../lib/ws-protocol"

/** In-flight assistant output, accumulated from session_stream deltas. */
export type StreamBuffer = { text: string; thinking: string; tool: string }

type ProjectStoreState = {
  projects: ProjectMeta[]
  sessionsByProject: Record<string, SessionMeta[]>
  providers: ProviderAccount[]
  models: ModelEntry[]
  extensions: ExtensionEntry[]
  skills: SkillEntry[]
  entriesBySession: Record<string, Entry[]>
  leafBySession: Record<string, string>
  statsBySession: Record<string, SessionStats>
  streamBySession: Record<string, StreamBuffer>
  /** "<provider>/<modelId>" pi is currently on, per cwd — from pi, not from a UI guess */
  modelByCwd: Record<string, string>
  /** models pi reported as usable, per cwd (get_available_models) */
  availableByCwd: Record<string, { provider: string; id: string; name?: string; contextWindow?: number; reasoning?: boolean }[]>
  /** last directory listing (Files pane) — real readdir from the Shell Service */
  dirListing: { cwd: string; path: string; entries: { name: string; type: "dir" | "file"; size: number; mtime: number }[]; truncated: boolean } | null
  lastError: { code: string; message: string } | null
  testResult: { providerId: string; ok: boolean; latencyMs?: number; error?: { code: string; message: string } } | null
  agentEvents: { cwd: string; event: unknown }[]
  pendingExtensionUI: { cwd: string; requestId: string; kind: string; data: unknown; extensionId?: string } | null
  extensionWidgets: Record<string, { lines?: string[]; placement?: string }>
  extensionStatuses: Record<string, string>
}

const state: ProjectStoreState = {
  projects: [],
  sessionsByProject: {},
  providers: [],
  models: [],
  extensions: [],
  skills: [],
  entriesBySession: {},
  leafBySession: {},
  statsBySession: {},
  streamBySession: {},
  modelByCwd: {},
  availableByCwd: {},
  dirListing: null,
  lastError: null,
  testResult: null,
  agentEvents: [],
  pendingExtensionUI: null,
  extensionWidgets: {},
  extensionStatuses: {},
}

const EMPTY_SESSIONS: SessionMeta[] = []
const EMPTY_ENTRIES: Entry[] = []
const EMPTY_STREAM: StreamBuffer = { text: "", thinking: "", tool: "" }
const EMPTY_AVAILABLE: { provider: string; id: string; name?: string; contextWindow?: number; reasoning?: boolean }[] = []
const listeners = new Set<() => void>()
function emit() { for (const l of listeners) l() }
function subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) }

function applyStreamDelta(sessionId: string, delta: StreamDelta) {
  if (!sessionId) return
  const prev = state.streamBySession[sessionId] ?? EMPTY_STREAM
  let next: StreamBuffer
  switch (delta.kind) {
    case "text": next = { ...prev, text: prev.text + delta.text }; break
    case "thinking": next = { ...prev, thinking: prev.thinking + delta.text }; break
    case "tool": next = { ...prev, tool: delta.name }; break
    // `done`/`error` end the stream — the authoritative entry follows and clears it
    default: next = { ...prev, tool: "" }; break
  }
  state.streamBySession = { ...state.streamBySession, [sessionId]: next }
}

function clearStream(sessionId: string) {
  if (!sessionId || !(sessionId in state.streamBySession)) return
  const next = { ...state.streamBySession }
  delete next[sessionId]
  state.streamBySession = next
}

function handleEvent(ev: ShellEvent) {
  switch (ev.t) {
    case "projects_snapshot": state.projects = ev.projects; break
    case "session_list": state.sessionsByProject[ev.projectId] = ev.sessions; break
    case "session_snapshot":
      state.entriesBySession[ev.sessionId] = ev.entries
      state.leafBySession[ev.sessionId] = ev.leafId
      if (ev.model && ev.cwd) state.modelByCwd = { ...state.modelByCwd, [ev.cwd]: ev.model }
      clearStream(ev.sessionId)
      break
    case "model_changed":
      state.modelByCwd = { ...state.modelByCwd, [ev.cwd]: `${ev.provider}/${ev.modelId}` }
      break
    case "available_models":
      state.availableByCwd = { ...state.availableByCwd, [ev.cwd]: ev.models }
      break
    case "dir_listing": state.dirListing = ev; break
    case "session_stats": state.statsBySession[ev.sessionId] = ev.stats; break
    case "session_entry": {
      // pi appended a session entry (message / compaction / model change …).
      // Dedupe by id: a snapshot may already contain it.
      const prev = state.entriesBySession[ev.sessionId] ?? EMPTY_ENTRIES
      if (!prev.some(e => e.id === ev.entry.id)) {
        state.entriesBySession = { ...state.entriesBySession, [ev.sessionId]: [...prev, ev.entry] }
      }
      state.leafBySession = { ...state.leafBySession, [ev.sessionId]: ev.entry.id }
      clearStream(ev.sessionId)
      break
    }
    case "session_stream": applyStreamDelta(ev.sessionId, ev.delta); break
    case "providers_snapshot": state.providers = ev.providers; break
    case "models_snapshot": state.models = ev.models; break
    case "extensions_snapshot": state.extensions = ev.extensions; break
    case "skills_snapshot": state.skills = ev.skills; break
    case "extension_ui_request": {
      const kind = (ev as { kind: string }).kind
      if (kind === "select" || kind === "confirm" || kind === "input" || kind === "editor") {
        state.pendingExtensionUI = { cwd: ev.cwd, requestId: ev.requestId, kind, data: ev.data, extensionId: (ev as { extensionId?: string }).extensionId }
      } else if (kind === "notify") {
        const d = ev.data as { message?: string } | undefined
        state.lastError = { code: "notify", message: String(d?.message ?? ev.data) }
      } else if (kind === "setStatus") {
        const d = ev.data as { statusKey?: string; statusText?: string }
        if (d?.statusKey) {
          const next = { ...state.extensionStatuses }
          if (d.statusText == null) delete next[d.statusKey]
          else next[d.statusKey] = d.statusText
          state.extensionStatuses = next
        }
      } else if (kind === "setWidget") {
        const d = ev.data as { widgetKey?: string; widgetLines?: string[]; widgetPlacement?: string }
        if (d?.widgetKey) {
          const next = { ...state.extensionWidgets }
          if (d.widgetLines == null) delete next[d.widgetKey]
          else next[d.widgetKey] = { lines: d.widgetLines, placement: d.widgetPlacement }
          state.extensionWidgets = next
        }
      }
      break
    }
    case "extension_result": state.pendingExtensionUI = null; break
    case "provider_test_result": state.testResult = ev; break
    case "agent_event": {
      const inner = ev.event as Record<string, unknown> | null
      if (inner && inner["type"] === "extension_ui_request") {
        const method = String(inner["method"] ?? "")
        if (["select","confirm","input","editor"].includes(method)) {
          state.pendingExtensionUI = { cwd: ev.cwd, requestId: String(inner["id"] ?? ""), kind: method, data: inner, extensionId: String(inner["extensionId"] ?? "") }
          break
        }
      }
      state.agentEvents = [...state.agentEvents.slice(-50), { cwd: ev.cwd, event: ev.event }]; break
    }
    case "rpc_error": state.lastError = { code: "rpc_error", message: ev.message }; break
    case "error": state.lastError = { code: ev.code, message: ev.message }; break
  }
  emit()
}

// attach once
wsClient.on(handleEvent)
wsClient.connect()

export function useProjects() {
  const getSnapshot = useCallback(() => state.projects, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useSessions(projectId: string) {
  const getSnapshot = useCallback(() => state.sessionsByProject[projectId] ?? EMPTY_SESSIONS, [projectId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useProviders() {
  const getSnapshot = useCallback(() => state.providers, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useModels() {
  const getSnapshot = useCallback(() => state.models, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useSessionEntries(sessionId: string) {
  const getSnapshot = useCallback(() => state.entriesBySession[sessionId] ?? EMPTY_ENTRIES, [sessionId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useSessionStats(sessionId: string) {
  const getSnapshot = useCallback(() => state.statsBySession[sessionId] ?? null, [sessionId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useSessionStream(sessionId: string) {
  const getSnapshot = useCallback(() => state.streamBySession[sessionId] ?? EMPTY_STREAM, [sessionId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useSessionLeaf(sessionId: string) {
  const getSnapshot = useCallback(() => state.leafBySession[sessionId] ?? "", [sessionId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useActiveModel(cwd: string) {
  const getSnapshot = useCallback(() => state.modelByCwd[cwd] ?? "", [cwd])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useAvailableModels(cwd: string) {
  const getSnapshot = useCallback(() => state.availableByCwd[cwd] ?? EMPTY_AVAILABLE, [cwd])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useDirListing() {
  const getSnapshot = useCallback(() => state.dirListing, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useLastError() {
  const getSnapshot = useCallback(() => state.lastError, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useTestResult() {
  const getSnapshot = useCallback(() => state.testResult, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useAgentEvents() {
  const getSnapshot = useCallback(() => state.agentEvents, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useExtensions() {
  const getSnapshot = useCallback(() => state.extensions, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useSkills() {
  const getSnapshot = useCallback(() => state.skills, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function usePendingExtensionUI() {
  const getSnapshot = useCallback(() => state.pendingExtensionUI, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useExtensionStatuses() {
  const getSnapshot = useCallback(() => state.extensionStatuses, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function useExtensionWidgets() {
  const getSnapshot = useCallback(() => state.extensionWidgets, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
export function clearPendingExtensionUI() { state.pendingExtensionUI = null; emit() }
export function getState() { return state }
