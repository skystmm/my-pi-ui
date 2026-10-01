// Agent commands: everything that drives the live pi session (prompt/steer/abort,
// model + thinking level, fork/clone/compact, session-tree read).
import { liveSessions } from "../pi-adapter/index.js"
import { pidForCwd } from "../project-scanner.js"
import { ensureLiveSession } from "../session-router.js"
import { scheduleStatsPush } from "../stats-push.js"
import { getOpenSession, setOpenSession } from "../ws-util.js"
import { setActiveSession } from "../active-session.js"
import { getSessionSnapshot } from "../session-bridge/jsonl-watcher.js"
import { discardPreferenceTurn, rememberPreferenceTurn } from "../memory/suggestions.js"
import { projectsSnapshot, recordPendingSession, sessionsWithPending } from "./session.js"
import type { Ctx } from "./context.js"
import type { ShellCommand } from "../ws-protocol.js"

export async function prompt(ctx: Ctx, cmd: Extract<ShellCommand, { t: "prompt" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) {
    ctx.send({ t: "prompt_result", requestId: cmd.requestId, accepted: false, message: "项目目录不可用" })
    return
  }
  if (!await ensureLiveSession(ctx.ws, ctx.wss, cwd)) {
    ctx.send({ t: "prompt_result", requestId: cmd.requestId, accepted: false, message: "会话切换失败，请检查错误提示" })
    return
  }
  const sid = getOpenSession(ctx.ws)?.sessionId ?? cmd.sessionId ?? ""
  rememberPreferenceTurn(cwd, sid, cmd.message)
  try {
    await liveSessions.getAdapter(cwd).prompt(cmd.message, cmd.images)
    ctx.send({ t: "prompt_result", requestId: cmd.requestId, accepted: true })
  } catch (e) {
    discardPreferenceTurn(cwd)
    ctx.send({ t: "prompt_result", requestId: cmd.requestId, accepted: false, message: (e as Error)?.message ?? "prompt failed" })
  }
}

export async function steer(ctx: Ctx, cmd: Extract<ShellCommand, { t: "steer" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  if (!await ensureLiveSession(ctx.ws, ctx.wss, cwd)) return
  try {
    await liveSessions.getAdapter(cwd).steer(cmd.message, cmd.images)
  } catch (e) {
    ctx.fail("steer_failed", (e as Error)?.message ?? "steer failed")
  }
}

export async function abort(ctx: Ctx, cmd: Extract<ShellCommand, { t: "abort" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  const adapter = liveSessions.peek(cwd) // nothing to abort before the adapter exists
  if (!adapter) return
  try { await adapter.abort() } catch (e) { ctx.fail("abort_failed", (e as Error)?.message ?? "abort failed") }
}

export async function setModel(ctx: Ctx, cmd: Extract<ShellCommand, { t: "set_model" }>) {
  // modelId travels as "<provider>/<modelId>": pi's set_model wants the pi
  // provider id (the models.json / auth.json key), not a display name.
  const slash = cmd.modelId.indexOf("/")
  if (slash === -1) return ctx.fail("invalid_model_id", "模型 id 需为 <provider>/<modelId> 形式")
  const provider = cmd.modelId.slice(0, slash)
  const modelId = cmd.modelId.slice(slash + 1)
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  try {
    const adapter = liveSessions.getAdapter(cwd)
    await adapter.setModel(provider, modelId)
    const st = await adapter.getState() as { thinkingLevel?: unknown }
    ctx.send({ t: "model_changed", cwd, provider, modelId, thinkingLevel: typeof st?.thinkingLevel === "string" ? st.thinkingLevel : "" })
    scheduleStatsPush(ctx.wss, cwd)
  } catch (e) {
    ctx.fail("set_model_failed", (e as Error)?.message ?? "set_model failed")
  }
}

export async function setThinking(ctx: Ctx, cmd: Extract<ShellCommand, { t: "set_thinking" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  try {
    await liveSessions.getAdapter(cwd).setThinkingLevel(cmd.level)
  } catch (e) {
    ctx.fail("set_thinking_failed", (e as Error)?.message ?? "set_thinking_level failed")
  }
}

async function announceNewSession(ctx: Ctx, cwd: string): Promise<string> {
  const state = await liveSessions.getAdapter(cwd).getState() as { sessionId?: unknown; model?: unknown; thinkingLevel?: unknown }
  if (typeof state.sessionId !== "string" || !state.sessionId) throw new Error("Pi 未返回新会话 id")
  const pid = pidForCwd(cwd)
  const sid = state.sessionId
  recordPendingSession(pid, sid, typeof state.model === "string" ? state.model : "", typeof state.thinkingLevel === "string" ? state.thinkingLevel : "")
  setActiveSession(cwd, sid)
  setOpenSession(ctx.ws, pid, sid, cwd)
  ctx.broadcast({ t: "projects_snapshot", projects: projectsSnapshot() })
  ctx.broadcast({ t: "session_list", projectId: pid, sessions: await sessionsWithPending(pid) })
  ctx.send({ t: "session_created", projectId: pid, sessionId: sid, cwd })
  return sid
}

export async function fork(ctx: Ctx, cmd: Extract<ShellCommand, { t: "fork" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "fork", ok: false, message: "项目目录不可用" })
  if (!await ensureLiveSession(ctx.ws, ctx.wss, cwd)) return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "fork", ok: false, message: "会话切换失败" })
  try {
    const result = await liveSessions.getAdapter(cwd).fork(cmd.fromEntryId) as { cancelled?: boolean }
    if (result?.cancelled) return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "fork", ok: false, message: "Pi 取消了分叉" })
  } catch (e) {
    return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "fork", ok: false, message: (e as Error)?.message ?? "fork failed" })
  }
  try {
    const sessionId = await announceNewSession(ctx, cwd)
    ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "fork", ok: true, message: "已创建分叉会话", sessionId })
  } catch {
    ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "fork", ok: true, message: "已创建分叉会话；列表刷新失败，请重新打开项目" })
  }
}

export async function clone(ctx: Ctx, cmd: Extract<ShellCommand, { t: "clone" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "clone", ok: false, message: "项目目录不可用" })
  if (!await ensureLiveSession(ctx.ws, ctx.wss, cwd)) return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "clone", ok: false, message: "会话切换失败" })
  try {
    const result = await liveSessions.getAdapter(cwd).clone() as { cancelled?: boolean }
    if (result?.cancelled) return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "clone", ok: false, message: "Pi 取消了克隆" })
  } catch (e) {
    return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "clone", ok: false, message: (e as Error)?.message ?? "clone failed" })
  }
  try {
    const sessionId = await announceNewSession(ctx, cwd)
    ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "clone", ok: true, message: "已克隆会话", sessionId })
  } catch {
    ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "clone", ok: true, message: "已克隆会话；列表刷新失败，请重新打开项目" })
  }
}

export async function compact(ctx: Ctx, cmd: Extract<ShellCommand, { t: "compact" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "compact", ok: false, message: "项目目录不可用" })
  if (!await ensureLiveSession(ctx.ws, ctx.wss, cwd)) return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "compact", ok: false, message: "会话切换失败" })
  try {
    await liveSessions.getAdapter(cwd).compact(cmd.customInstructions)
  } catch (e) {
    return ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "compact", ok: false, message: (e as Error)?.message ?? "compact failed" })
  }
  try {
    const open = getOpenSession(ctx.ws)
    if (open?.cwd === cwd) {
      const snapshot = await getSessionSnapshot(open.projectId, open.sessionId)
      if (snapshot) ctx.send({ t: "session_snapshot", sessionId: open.sessionId, projectId: open.projectId, cwd, leafId: snapshot.leafId, entries: snapshot.entries, model: snapshot.model, thinkingLevel: snapshot.thinkingLevel })
    }
    scheduleStatsPush(ctx.wss, cwd)
    ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "compact", ok: true, message: "会话压缩完成" })
  } catch {
    ctx.send({ t: "session_operation_result", requestId: cmd.requestId, operation: "compact", ok: true, message: "会话压缩完成；视图刷新失败，请重新打开会话" })
  }
}

/** pi's rpc surface has no "switch leaf" command — get_tree only reads. */
export async function navigateTree(ctx: Ctx, cmd: Extract<ShellCommand, { t: "navigate_tree" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  try {
    const tree = await liveSessions.getAdapter(cwd).getTree()
    ctx.send({ t: "session_tree", cwd, tree })
  } catch (e) {
    ctx.fail("get_tree_failed", (e as Error)?.message ?? "get_tree failed")
  }
}
