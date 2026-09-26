// Live transcript routing.
//
// pi's rpc stream carries agent-level events (message_start / message_update /
// message_end …), NOT session `entry_appended`. The authoritative timeline is
// therefore the session file pi writes: `pushSessionTail` sends every entry the
// client has not seen yet (with pi's real ids and parentIds), while the stream
// deltas only carry in-flight text.
import type { WebSocket, WebSocketServer } from "ws"
import { liveSessions } from "./pi-adapter/index.js"
import { getSessionSnapshot, resolveSessionFile } from "./session-bridge/jsonl-watcher.js"
import { getActiveSession, setActiveSession } from "./active-session.js"
import { getOpenSession, sendToSession, send } from "./ws-util.js"
import { scheduleStatsPush } from "./stats-push.js"

/** What each open session has already been sent, so a tail push only sends the rest. */
const pushedEntries = new Map<string, Set<string>>()

export function seedPushedEntries(sessionId: string, ids: Iterable<string>): void {
  pushedEntries.set(sessionId, new Set(ids))
}

export function forgetPushedEntries(sessionId: string): void { pushedEntries.delete(sessionId) }

/** Learn the live adapter's session id without blocking the event stream. */
export async function learnActiveSession(cwd: string): Promise<void> {
  const adapter = liveSessions.peek(cwd)
  if (!adapter) return
  try {
    const st = await adapter.getState() as { sessionId?: unknown }
    if (typeof st?.sessionId === "string" && st.sessionId) setActiveSession(cwd, st.sessionId)
  } catch { /* adapter not ready yet — the next increment retries */ }
}

export async function pushSessionTail(wss: WebSocketServer, projectId: string, sessionId: string): Promise<void> {
  const snapshot = await getSessionSnapshot(projectId, sessionId)
  if (!snapshot) return
  let seen = pushedEntries.get(sessionId)
  if (!seen) { seen = new Set(); pushedEntries.set(sessionId, seen) }
  const fresh = snapshot.entries.filter(e => !seen.has(e.id))
  if (!fresh.length) return
  for (const entry of fresh) {
    seen.add(entry.id)
    sendToSession(wss, sessionId, { t: "session_entry", cwd: snapshot.cwd, sessionId, entry })
  }
  scheduleStatsPush(wss, snapshot.cwd)
}

/**
 * pi holds one session per adapter. When the client is viewing a session the
 * adapter is not on, a prompt would land in a different conversation — switch pi
 * first. Returns false when the switch was refused.
 */
export async function ensureLiveSession(ws: WebSocket, wss: WebSocketServer, cwd: string): Promise<boolean> {
  const open = getOpenSession(ws)
  if (!open || open.cwd !== cwd) return true
  if (getActiveSession(cwd) === open.sessionId) return true
  const path = resolveSessionFile(open.projectId, open.sessionId)
  if (!path) {
    send(ws, { t: "error", code: "session_not_found", message: `会话文件不存在：${open.sessionId}` })
    return false
  }
  const adapter = liveSessions.getAdapter(cwd)
  try {
    const r = await adapter.switchSession(path) as { cancelled?: boolean } | undefined
    if (r?.cancelled) {
      send(ws, { t: "error", code: "switch_cancelled", message: "pi 取消了会话切换（可能有排队中的消息）" })
      return false
    }
  } catch (e) {
    send(ws, { t: "error", code: "switch_failed", message: (e as Error)?.message ?? "switch_session failed" })
    return false
  }
  setActiveSession(cwd, open.sessionId)
  // The client already holds this session's history — don't replay it as increments.
  const snap = await getSessionSnapshot(open.projectId, open.sessionId)
  seedPushedEntries(open.sessionId, snap?.entries.map(e => e.id) ?? [])
  send(ws, { t: "session_switched", cwd, sessionId: open.sessionId, model: "", thinkingLevel: "" })
  scheduleStatsPush(wss, cwd)
  return true
}
