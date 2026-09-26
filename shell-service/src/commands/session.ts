// Project + session commands: scanning ~/.pi/agent/sessions, opening projects,
// creating/loading sessions.
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { liveSessions } from "../pi-adapter/index.js"
import { scanProjects, pidForCwd, registerPidCwd, cwdForPid } from "../project-scanner.js"
import { getSessionsDir } from "../paths.js"
import { markProjects, markSessions, setProjectArchived, setSessionArchived } from "../archive.js"
import { chooseProjectDirectory } from "../directory-picker.js"
import { listSessionsForProject, getSessionSnapshot } from "../session-bridge/jsonl-watcher.js"
import { setTrusted } from "../trust.js"
import { setOpenSession } from "../ws-util.js"
import { seedPushedEntries } from "../session-router.js"
import { pushSessionStats } from "../stats-push.js"
import { setActiveSession } from "../active-session.js"
import type { Ctx } from "./context.js"
import type { ShellCommand, SessionMeta } from "../ws-protocol.js"

/**
 * pi defers the .jsonl flush until the first assistant message, so a session
 * created with new_session is invisible on disk for a while. Track it per project
 * so the sidebar can show it as pending instead of "暂无会话".
 */
const pendingLive = new Map<string, { sid: string; model: string; thinking: string; mtime: number }>()

export async function sessionsWithPending(pid: string): Promise<SessionMeta[]> {
  const real = await listSessionsForProject(pid)
  const p = pendingLive.get(pid)
  if (!p) return markSessions(pid, real)
  if (Date.now() - p.mtime > 10 * 60 * 1000) { pendingLive.delete(pid); return markSessions(pid, real) } // stale: adapter gone
  // pi names flushed files <ts>_<sessionId>.jsonl — prune once the real file lands
  if (real.some(s => s.fileName.endsWith(`_${p.sid}.jsonl`) || s.id === p.sid)) { pendingLive.delete(pid); return markSessions(pid, real) }
  return markSessions(pid, [{ id: p.sid, fileName: p.sid, title: "新会话 · 未落盘", model: p.model, thinking: p.thinking, mtime: p.mtime, entryCount: 0, hasCompaction: false, hasBranch: false }, ...real])
}

export function projectsSnapshot() { return markProjects(scanProjects()) }

export function listProjects(ctx: Ctx) {
  ctx.send({ t: "projects_snapshot", projects: projectsSnapshot() })
}

let pickerOpen = false
export async function pickProjectDirectory(ctx: Ctx) {
  if (pickerOpen) {
    ctx.send({ t: "project_directory_picker", status: "error", message: "目录选择窗口已打开" })
    return
  }
  pickerOpen = true
  try {
    const cwd = await chooseProjectDirectory()
    ctx.send(cwd ? { t: "project_directory_picker", status: "selected", cwd } : { t: "project_directory_picker", status: "cancelled" })
  } catch (error) {
    ctx.send({ t: "project_directory_picker", status: "error", message: (error as Error).message })
  } finally {
    pickerOpen = false
  }
}

export async function archiveProject(ctx: Ctx, cmd: Extract<ShellCommand, { t: "set_project_archived" }>) {
  if (typeof cmd.projectId !== "string" || !scanProjects().some(p => p.id === cmd.projectId)) {
    ctx.fail("project_not_found", "项目不存在")
    return
  }
  await setProjectArchived(cmd.projectId, cmd.archived === true)
  ctx.broadcast({ t: "projects_snapshot", projects: projectsSnapshot() })
}

export async function archiveSession(ctx: Ctx, cmd: Extract<ShellCommand, { t: "set_session_archived" }>) {
  if (typeof cmd.projectId !== "string" || typeof cmd.sessionId !== "string" ||
    !(await sessionsWithPending(cmd.projectId)).some(s => s.id === cmd.sessionId)) {
    ctx.fail("session_not_found", "会话不存在")
    return
  }
  await setSessionArchived(cmd.projectId, cmd.sessionId, cmd.archived === true)
  ctx.broadcast({ t: "session_list", projectId: cmd.projectId, sessions: await sessionsWithPending(cmd.projectId) })
}

export function trustProject(ctx: Ctx, cmd: Extract<ShellCommand, { t: "trust_project" }>) {
  setTrusted(cmd.cwd, cmd.trusted)
  ctx.broadcast({ t: "projects_snapshot", projects: projectsSnapshot() })
}

export async function openProject(ctx: Ctx, cmd: Extract<ShellCommand, { t: "open_project" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请填写项目绝对路径")
  if (!cwd) return
  const pid = pidForCwd(cwd)
  registerPidCwd(pid, cwd)
  try { mkdirSync(join(getSessionsDir(), pid), { recursive: true }) } catch {}
  if (projectsSnapshot().some(p => p.id === pid && p.archived)) await setProjectArchived(pid, false)
  ctx.broadcast({ t: "projects_snapshot", projects: projectsSnapshot() })
  ctx.send({ t: "project_opened", projectId: pid, cwd })
  ctx.send({ t: "session_list", projectId: pid, sessions: await sessionsWithPending(pid) })
}

export async function listSessions(ctx: Ctx, cmd: Extract<ShellCommand, { t: "list_sessions" }>) {
  ctx.send({ t: "session_list", projectId: cmd.projectId, sessions: await sessionsWithPending(cmd.projectId) })
}

export async function getSession(ctx: Ctx, cmd: Extract<ShellCommand, { t: "get_session" }>) {
  const { projectId, sessionId } = cmd
  const snapshot = await getSessionSnapshot(projectId, sessionId)
  if (snapshot) {
    setOpenSession(ctx.ws, projectId, sessionId, snapshot.cwd)
    seedPushedEntries(sessionId, snapshot.entries.map(e => e.id))
    ctx.send({ t: "session_snapshot", sessionId, projectId, cwd: snapshot.cwd, leafId: snapshot.leafId, entries: snapshot.entries, model: snapshot.model, thinkingLevel: snapshot.thinkingLevel })
    void pushSessionStats(ctx.wss, snapshot.cwd)
    return
  }
  // Pre-flush session: created via new_session but pi has not written the .jsonl
  // yet. Serve an empty snapshot from the live adapter instead of session_not_found.
  try {
    const cwd = cwdForPid(projectId)
    const adapter = cwd ? liveSessions.peek(cwd) : undefined
    const st = (await adapter?.getState()) as { sessionId?: unknown; model?: unknown; thinkingLevel?: unknown } | undefined
    const model = st?.model as { provider?: string; id?: string } | string | undefined
    const modelLabel = typeof model === "string" ? model : model?.provider && model?.id ? `${model.provider}/${model.id}` : ""
    if (adapter && cwd && st && st.sessionId === sessionId) {
      setOpenSession(ctx.ws, projectId, sessionId, cwd)
      seedPushedEntries(sessionId, [])
      ctx.send({ t: "session_snapshot", sessionId, projectId, cwd, leafId: "", entries: [], model: modelLabel, thinkingLevel: typeof st.thinkingLevel === "string" ? st.thinkingLevel : "" })
      void pushSessionStats(ctx.wss, cwd)
      return
    }
  } catch { /* fall through to not-found */ }
  ctx.fail("session_not_found", `会话不存在：${sessionId}`)
}

export async function createSession(ctx: Ctx, cmd: Extract<ShellCommand, { t: "create_session" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  const pid = pidForCwd(cwd)
  try { mkdirSync(join(getSessionsDir(), pid), { recursive: true }) } catch {}
  try {
    const adapter = liveSessions.getAdapter(cwd)
    await adapter.newSession()
    // Take the id straight from get_state: pi does not flush the .jsonl until the
    // first assistant message, so polling the filesystem would never find it.
    const st = await adapter.getState() as { sessionId?: unknown; sessionFile?: unknown; model?: unknown; thinkingLevel?: unknown }
    const base = (p: string) => p.split("/").pop()?.replace(/\.jsonl$/, "") ?? p
    const sid = (typeof st.sessionId === "string" && st.sessionId)
      ? st.sessionId
      : (typeof st.sessionFile === "string" && st.sessionFile ? base(st.sessionFile) : undefined)
    const model = typeof st.model === "string" ? st.model : ""
    const thinking = typeof st.thinkingLevel === "string" ? st.thinkingLevel : ""
    registerPidCwd(pid, cwd)
    if (sid) {
      pendingLive.set(pid, { sid, model, thinking, mtime: Date.now() })
      setActiveSession(cwd, sid)
    }
    ctx.broadcast({ t: "projects_snapshot", projects: projectsSnapshot() })
    ctx.broadcast({ t: "session_list", projectId: pid, sessions: await sessionsWithPending(pid) })
    if (!sid) {
      ctx.fail("session_not_visible", "会话已创建但未能取到会话 id，稍后刷新重试")
      return
    }
    ctx.send({ t: "session_created", projectId: pid, sessionId: sid, cwd })
    setOpenSession(ctx.ws, pid, sid, cwd)
    seedPushedEntries(sid, [])
    ctx.send({ t: "session_snapshot", sessionId: sid, projectId: pid, cwd, leafId: "", entries: [], model, thinkingLevel: thinking })
  } catch (e) {
    ctx.fail("create_session_failed", ((e as Error)?.message ?? String(e)).slice(0, 200))
  }
}
