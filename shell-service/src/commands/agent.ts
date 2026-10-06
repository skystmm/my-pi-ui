// Agent commands: everything that drives the live pi session (prompt/steer/abort,
// model + thinking level, fork/clone/compact, session-tree read).
import { liveSessions } from "../pi-adapter/index.js"
import { adoptLiveSession } from "./session.js"
import { ensureLiveSession } from "../session-router.js"
import { scheduleStatsPush } from "../stats-push.js"
import type { Ctx } from "./context.js"
import type { ShellCommand } from "../ws-protocol.js"

export async function prompt(ctx: Ctx, cmd: Extract<ShellCommand, { t: "prompt" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  if (!await ensureLiveSession(ctx.ws, ctx.wss, cwd)) return
  try {
    await liveSessions.getAdapter(cwd).prompt(cmd.message, cmd.images)
  } catch (e) {
    ctx.fail("prompt_failed", (e as Error)?.message ?? "prompt failed")
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
  try { const queued = await adapter.clearQueue(); await adapter.abort(); ctx.send({ t: "queue_restored", cwd, steering: queued.steering ?? [], followUp: queued.followUp ?? [] }) } catch (e) { ctx.fail("abort_failed", (e as Error)?.message ?? "abort failed") }
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

export async function fork(ctx: Ctx, cmd: Extract<ShellCommand, { t: "fork" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  if (!await ensureLiveSession(ctx.ws, ctx.wss, cwd)) return
  try {
    const result = await liveSessions.getAdapter(cwd).fork(cmd.fromEntryId) as { cancelled?: boolean; text?: string }
    if (!result?.cancelled) { await adoptLiveSession(ctx, cwd); if (result?.text) ctx.send({ t: "queue_restored", cwd, steering: [result.text], followUp: [] }) }
  } catch (e) {
    ctx.fail("fork_failed", (e as Error)?.message ?? "fork failed")
  }
}

export async function clone(ctx: Ctx, cmd: Extract<ShellCommand, { t: "clone" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  if (!await ensureLiveSession(ctx.ws, ctx.wss, cwd)) return
  try {
    const result = await liveSessions.getAdapter(cwd).clone() as { cancelled?: boolean }
    if (!result?.cancelled) await adoptLiveSession(ctx, cwd)
  } catch (e) {
    ctx.fail("clone_failed", (e as Error)?.message ?? "clone failed")
  }
}

export async function compact(ctx: Ctx, cmd: Extract<ShellCommand, { t: "compact" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  if (!await ensureLiveSession(ctx.ws, ctx.wss, cwd)) return
  try {
    await liveSessions.getAdapter(cwd).compact(cmd.customInstructions)
    scheduleStatsPush(ctx.wss, cwd)
  } catch (e) {
    ctx.fail("compact_failed", (e as Error)?.message ?? "compact failed")
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
