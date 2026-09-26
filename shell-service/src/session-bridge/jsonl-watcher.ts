import { existsSync, readdirSync, realpathSync, statSync } from "node:fs"
import { join } from "node:path"
import { getSessionsDir } from "../paths.js"
import { isPathInside } from "../path-boundary.js"
import { readEntries, summarizeSession, type SessionEntry } from "../session-entries.js"
import type { SessionMeta } from "../ws-protocol.js"

function sessionsRoot() { return getSessionsDir() }

function projectDir(projectId: string): string | null {
  // A client-supplied id must be one directory name, not a relative path.
  if (!/^--[^/\\]*--$/.test(projectId)) return null
  try {
    const root = realpathSync(sessionsRoot())
    const dir = realpathSync(join(root, projectId))
    return dir !== root && isPathInside(root, dir) && statSync(dir).isDirectory() ? dir : null
  } catch { return null }
}

function sessionFile(dir: string, fileName: string): string | null {
  if (!fileName.endsWith(".jsonl") || fileName.includes("/") || fileName.includes("\\")) return null
  try {
    const file = realpathSync(join(dir, fileName))
    return isPathInside(dir, file) && statSync(file).isFile() ? file : null
  } catch { return null }
}

/** Kept for callers that only need the entries. */
export async function parseJsonlEntries(filePath: string): Promise<SessionEntry[]> {
  const { entries } = await readEntries(filePath)
  return entries
}

/**
 * Session list for one project directory. Metadata comes from a real parse of
 * each session file (title/model/thinking/counts) instead of the file name —
 * summarizeSession caches by (mtime, size) so untouched files are not re-read.
 */
export async function listSessionsForProject(projectId: string): Promise<SessionMeta[]> {
  const dir = projectDir(projectId)
  if (!dir) return []
  let files: string[] = []
  try { files = readdirSync(dir).filter(f => f.endsWith(".jsonl")) } catch { return [] }
  const metas = await Promise.all(files.map(async (f): Promise<SessionMeta | null> => {
    const fp = sessionFile(dir, f)
    if (!fp) return null
    const s = await summarizeSession(fp)
    if (!s) {
      // Unreadable or header-less (pi writes the file lazily) — still list it.
      let mtime = 0
      try { mtime = statSync(fp).mtimeMs } catch { return null }
      return { id: f.replace(/\.jsonl$/, ""), fileName: f, title: "", model: "", thinking: "", mtime, entryCount: 0, hasCompaction: false, hasBranch: false }
    }
    let mtime = s.mtimeMs
    try { mtime = statSync(fp).mtimeMs } catch {}
    return {
      id: s.id || f.replace(/\.jsonl$/, ""),
      fileName: f,
      title: s.title || f.replace(/\.jsonl$/, ""),
      model: s.model,
      thinking: s.thinking,
      mtime,
      entryCount: s.entryCount,
      hasCompaction: s.hasCompaction,
      hasBranch: s.hasBranch,
      leafId: s.leafId,
      projectId,
    }
  }))
  const out = metas.filter((m): m is SessionMeta => m !== null)
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

export interface SessionSnapshot {
  entries: SessionEntry[]
  leafId: string
  cwd: string
  model: string
  thinkingLevel: string
}

/** Resolve a session id (or truncated id / file name) to its .jsonl path. */
export function resolveSessionFile(projectId: string, sessionId: string): string | null {
  const dir = projectDir(projectId)
  if (!dir || !sessionId || sessionId.includes("/") || sessionId.includes("\\") || sessionId === "." || sessionId === "..") return null
  const base = sessionId.replace(/\.jsonl$/, "")
  const direct = sessionFile(dir, `${base}.jsonl`)
  if (direct) return direct
  // pi names files `<fileTimestamp>_<sessionId>.jsonl`, and ids may also be
  // handed to us truncated — match on the id part, not just the prefix.
  try {
    const files = readdirSync(dir)
    const hit = files.find(f => {
      if (!f.endsWith(".jsonl")) return false
      const name = f.replace(/\.jsonl$/, "")
      const idPart = name.includes("_") ? name.slice(name.lastIndexOf("_") + 1) : name
      return idPart === base || idPart.startsWith(base) || base.startsWith(idPart)
    })
    return hit ? sessionFile(dir, hit) : null
  } catch { return null }
}

export async function getSessionSnapshot(projectId: string, sessionId: string): Promise<SessionSnapshot | null> {
  const fp = resolveSessionFile(projectId, sessionId)
  if (!fp || !existsSync(fp)) return null

  const { header, entries } = await readEntries(fp)
  const last = entries.length ? entries[entries.length - 1] : null
  let provider = ""
  let model = ""
  let thinking = ""
  for (const e of entries) {
    if (e.type === "model_change") { provider = e.provider; model = e.modelId }
    else if (e.type === "thinking_level_change") thinking = e.thinkingLevel
    else if (e.type === "message" && e.message?.role === "assistant") {
      if (e.message.provider) provider = e.message.provider
      if (e.message.model) model = e.message.model
    }
  }
  return {
    entries,
    leafId: last?.id ?? "",
    cwd: header?.cwd ?? "",
    model: provider && model ? `${provider}/${model}` : model,
    thinkingLevel: thinking,
  }
}

/**
 * Watch every project dir for session file changes. `depth: 1` is enough because
 * session files live directly in `--<escaped cwd>--/`.
 */
export function watchSessions(cb: (projectId: string) => void): () => void {
  const root = sessionsRoot()
  let watcher: import("chokidar").FSWatcher | null = null
  let timer: NodeJS.Timeout | null = null
  let cancelled = false
  const pending = new Set<string>()
  const flush = () => {
    const toFire = [...pending]
    pending.clear()
    for (const pid of toFire) cb(pid)
  }
  const debounced = (p: string) => {
    if (!p.endsWith(".jsonl")) return
    const parts = p.split("/")
    const projectId = parts[parts.length - 2] ?? ""
    if (!projectId.startsWith("--")) return
    pending.add(projectId)
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 50)
  }
  void import("chokidar").then(mod => {
    // The cleanup may already have run while this import was in flight.
    if (cancelled) return
    // Chokidar 4 treats globs as literal paths. Watch the sessions root and
    // keep only JSONL changes inside project directories in debounced().
    watcher = mod.watch(root, { depth: 2, ignoreInitial: true })
    watcher.on("add", debounced)
    watcher.on("change", debounced)
    watcher.on("unlink", debounced)
    watcher.on("error", () => { /* best effort: a vanished dir must not crash the service */ })
  }).catch(() => {})
  return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
    void watcher?.close()
  }
}
