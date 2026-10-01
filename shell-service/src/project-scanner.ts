import { existsSync, readdirSync, statSync, mkdirSync, realpathSync } from "node:fs"
import { join, basename } from "node:path"
import { getTrustState } from "./trust.js"
import { getSessionsDir } from "./paths.js"
import { isPathInside } from "./path-boundary.js"
import { readHeader } from "./session-entries.js"
import { readOpenedProjects } from "./opened-projects.js"
import type { ProjectMeta } from "./ws-protocol.js"

function sessionsRoot(): string {
  return getSessionsDir()
}

export function canonCwd(cwd: string): string {
  // resolve symlinks (macOS /tmp → /private/tmp) so our pid matches pi's session dir.
  // pi itself never realpaths (normalizePath only expands ~ / separators) — it sees
  // the already-resolved string via the child process cwd. realpathSync throws when
  // the leaf doesn't exist (open_project doesn't mkdir cwd), so fall back to
  // resolving the nearest existing ancestor and re-appending the remainder.
  try { return realpathSync(cwd) } catch {}
  const parts = cwd.split("/").filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    try {
      const base = realpathSync("/" + parts.slice(0, i).join("/") || "/")
      return base + "/" + parts.slice(i).join("/")
    } catch {}
  }
  return cwd
}

// pid → cwd for dirs WE created via open_project (empty dirs have no session headers yet)
const pidToCwd = new Map<string, string>()
export function registerPidCwd(pid: string, cwd: string): void {
  pidToCwd.set(pid, canonCwd(cwd))
}

export function cwdForPid(pid: string): string | undefined {
  return pidToCwd.get(pid)
}

export function pidForCwd(cwd: string): string {
  // mirror pi getDefaultSessionDirPath exactly (dist/core/session-manager.js):
  // strip one leading slash, replace every / \ : with a SINGLE dash, wrap in -- --
  return "--" + canonCwd(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--"
}

function readHeaderCwd(dir: string): string | undefined {
  // pi-style discovery: cwd comes from the session file header
  // (first line {"type":"session",...,"cwd":...}); the dirname itself is never
  // unescaped because single-dash encoding is ambiguous for names with dashes.
  let files: string[] = []
  try { files = readdirSync(dir).filter(f => f.endsWith(".jsonl")) } catch { return undefined }
  for (const f of files) {
    const file = safeSessionFile(dir, f)
    if (!file) continue
    const h = readHeader(file)
    if (h && typeof h.cwd === "string" && h.cwd) return h.cwd
  }
  return undefined
}

function safeSessionFile(dir: string, fileName: string): string | null {
  try {
    const file = realpathSync(join(dir, fileName))
    return isPathInside(realpathSync(dir), file) && statSync(file).isFile() ? file : null
  } catch { return null }
}

export function scanProjects(): ProjectMeta[] {
  const root = sessionsRoot()
  if (!existsSync(root)) {
    try { mkdirSync(root, { recursive: true }) } catch {}
    return []
  }
  let entries: string[] = []
  let realRoot: string
  try { realRoot = realpathSync(root); entries = readdirSync(root) } catch { return [] }
  const opened = new Map<string, string>()
  for (const cwd of readOpenedProjects()) {
    try {
      const realCwd = realpathSync(cwd)
      if (statSync(realCwd).isDirectory()) opened.set(pidForCwd(realCwd), realCwd)
    } catch { /* deleted projects are not shown */ }
  }
  const projects: ProjectMeta[] = []
  for (const e of entries) {
    if (!e.startsWith("--")) continue
    const full = join(root, e)
    let st: ReturnType<typeof statSync>
    try {
      if (!isPathInside(realRoot, realpathSync(full))) continue
      st = statSync(full)
      if (!st.isDirectory()) continue
    } catch { continue }
    const rawCwd = readHeaderCwd(full) ?? opened.get(e) ?? pidToCwd.get(e)
    if (!rawCwd) continue // header-less dir we didn't create (e.g. pi pre-flush) — pi listAll skips these too
    const cwd = canonCwd(rawCwd)
    const trust = getTrustState(cwd)
    // count jsonl files, lastActiveAt
    let sessionCount = 0
    let lastActiveAt = 0
    try {
      const files = readdirSync(full)
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue
        const file = safeSessionFile(full, f)
        if (!file) continue
        sessionCount++
        try {
          const m = statSync(file).mtimeMs
          if (m > lastActiveAt) lastActiveAt = m
        } catch {}
      }
    } catch {}
    const settingsOverride = existsSync(join(cwd, ".pi", "settings.json"))
    let localExtensions: string[] = []
    try {
      const extDir = join(cwd, ".pi", "extensions")
      if (existsSync(extDir)) localExtensions = readdirSync(extDir)
    } catch {}
    let localSkills: string[] = []
    try {
      const s1 = join(cwd, ".pi", "skills")
      const s2 = join(cwd, ".agents", "skills")
      const acc: string[] = []
      if (existsSync(s1)) acc.push(...readdirSync(s1))
      if (existsSync(s2)) acc.push(...readdirSync(s2))
      localSkills = acc
    } catch {}
    projects.push({
      id: e,
      cwd,
      displayName: basename(cwd) || cwd,
      trust,
      sessionCount,
      lastActiveAt,
      settingsOverride,
      localExtensions,
      localSkills,
    })
  }
  projects.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  return projects
}

export function watchProjects(cb: () => void): () => void {
  const root = sessionsRoot()
  if (!existsSync(root)) try { mkdirSync(root, { recursive: true }) } catch {}
  let watcher: import("chokidar").FSWatcher | null = null
  let timer: NodeJS.Timeout | null = null
  let cancelled = false
  const debounced = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(cb, 80)
  }
  void import("chokidar").then(mod => {
    // The cleanup may already have run while this import was in flight.
    if (cancelled) return
    watcher = mod.watch(root, { depth: 1, ignoreInitial: true })
    watcher.on("addDir", debounced)
    watcher.on("unlinkDir", debounced)
    watcher.on("add", debounced)
    watcher.on("unlink", debounced)
    watcher.on("error", () => { /* best effort: a vanished dir must not crash the service */ })
  }).catch(() => {})
  return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
    void watcher?.close()
  }
}
