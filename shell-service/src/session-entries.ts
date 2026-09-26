// Node-side session file access: reading pi's JSONL and summarizing sessions.
// The data model itself lives in session-entry-schema.ts (shared with the UI).
import { createReadStream, openSync, readSync, closeSync, existsSync, statSync } from "node:fs"
import { createInterface } from "node:readline"
import {
  isSessionHeader, parseEntryLine, messageText,
  type SessionEntry, type SessionHeader,
} from "./session-entry-schema.js"

export * from "./session-entry-schema.js"

export interface ReadEntriesResult { header: SessionHeader | null; entries: SessionEntry[] }

export async function readEntries(filePath: string): Promise<ReadEntriesResult> {
  const out: ReadEntriesResult = { header: null, entries: [] }
  if (!existsSync(filePath)) return out
  const rl = createInterface({ input: createReadStream(filePath, { encoding: "utf-8" }), crlfDelay: Infinity })
  for await (const line of rl) {
    const e = parseEntryLine(line)
    if (!e) continue
    if (isSessionHeader(e)) { if (!out.header) out.header = e; continue }
    out.entries.push(e)
  }
  return out
}

const READ_BUF = 4096
const MAX_HEADER_SCAN = 64 * 1024
const MAX_HEADER_LINE = 1024 * 1024

/** Read only the first line (the session header) — mirrors pi's readSessionHeader(). */
export function readHeader(filePath: string): SessionHeader | null {
  let fd = -1
  try {
    fd = openSync(filePath, "r")
    const buf = Buffer.allocUnsafe(READ_BUF)
    let scanned = 0
    let acc = ""
    while (scanned < MAX_HEADER_SCAN && acc.length < MAX_HEADER_LINE) {
      const n = readSync(fd, buf, 0, buf.length, null)
      if (n === 0) break
      scanned += n
      acc += buf.subarray(0, n).toString("utf8")
      const nl = acc.indexOf("\n")
      if (nl !== -1) { acc = acc.slice(0, nl); break }
    }
    const e = parseEntryLine(acc)
    return e && isSessionHeader(e) ? e : null
  } catch { return null }
  finally { if (fd >= 0) { try { closeSync(fd) } catch {} } }
}

// ---------------------------------------------------------------- summary + cache

export interface SessionSummary {
  id: string
  cwd: string
  /** user-set display name (latest session_info) */
  name?: string
  /** name ?? first user message ?? "" — what the sidebar shows */
  title: string
  /** current model: latest model_change, else the last assistant message's model */
  provider: string
  model: string
  thinking: string
  entryCount: number
  messageCount: number
  hasCompaction: boolean
  hasBranch: boolean
  leafId: string
  createdAt: number
  mtimeMs: number
  size: number
}

type CacheRow = { mtimeMs: number; size: number; summary: SessionSummary }
const summaryCache = new Map<string, CacheRow>()

/**
 * Summarize one session file. Mirrors pi's buildSessionInfo() semantics:
 * name = latest session_info, firstMessage = first user text, messageCount counts
 * message entries, model = latest model_change or the last assistant model.
 * Cached by (mtimeMs, size) so session listings never re-scan untouched files.
 */
export async function summarizeSession(filePath: string): Promise<SessionSummary | null> {
  let st: ReturnType<typeof statSync>
  try { st = statSync(filePath) } catch { return null }
  const hit = summaryCache.get(filePath)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.summary

  const { header, entries } = await readEntries(filePath)
  if (!header) return null

  let name: string | undefined
  let firstUser = ""
  let messageCount = 0
  let provider = ""
  let model = ""
  let thinking = ""
  let hasCompaction = false
  let hasBranch = false

  for (const e of entries) {
    switch (e.type) {
      case "session_info": name = e.name?.trim() || undefined; break
      case "model_change": provider = e.provider; model = e.modelId; break
      case "thinking_level_change": thinking = e.thinkingLevel; break
      case "compaction": hasCompaction = true; break
      case "branch_summary": hasBranch = true; break
      case "message": {
        messageCount++
        const m = e.message
        if (m?.role === "assistant") { if (m.provider) provider = m.provider; if (m.model) model = m.model }
        if (m?.role === "user" && !firstUser) firstUser = messageText(m).trim()
        break
      }
      default: break
    }
  }

  const summary: SessionSummary = {
    id: header.id,
    cwd: header.cwd,
    name,
    title: name || firstUser.slice(0, 80) || "",
    provider,
    model,
    thinking,
    entryCount: entries.length,
    messageCount,
    hasCompaction,
    hasBranch,
    leafId: entries.length ? entries[entries.length - 1].id : "",
    createdAt: header.timestamp ? Date.parse(header.timestamp) || 0 : 0,
    mtimeMs: st.mtimeMs,
    size: st.size,
  }
  summaryCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, summary })
  return summary
}

export function forgetSummary(filePath: string): void { summaryCache.delete(filePath) }
