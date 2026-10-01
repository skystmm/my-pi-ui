import { getOpenSession } from "../ws-util.js"
import { projectsSnapshot } from "./session.js"
import { openSqliteMemoryRepository } from "../memory/sqlite.js"
import { readMemorySettings, updateMemorySettings } from "../memory/settings.js"
import { listSuggestions, resolveSuggestion } from "../memory/suggestions.js"
import type { MemoryRepository, MemoryScope } from "../memory/repository.js"
import type { Ctx } from "./context.js"
import type { ShellCommand, MemoryScopeKind } from "../ws-protocol.js"

let sharedRepo: MemoryRepository | undefined
function repository(): MemoryRepository { return sharedRepo ??= openSqliteMemoryRepository() }

export function getSettings(ctx: Ctx) { ctx.send({ t: "memory_settings", ...readMemorySettings() }) }
export async function setSettings(ctx: Ctx, cmd: Extract<ShellCommand, { t: "set_memory_settings" }>) {
  ctx.broadcast({ t: "memory_settings", ...await updateMemorySettings({ recallEnabled: cmd.recallEnabled, suggestEnabled: cmd.suggestEnabled }) })
}

async function validatedScope(ctx: Ctx, kind: MemoryScopeKind, rawCwd?: string, sessionId?: string): Promise<MemoryScope | null> {
  if (kind === "app") return { kind: "app" }
  if (kind !== "project" && kind !== "session") throw new Error("无效记忆作用域")
  const cwd = await ctx.cwdOrError(rawCwd, "请先打开项目目录")
  if (!cwd) return null
  if (!projectsSnapshot().some(p => p.cwd === cwd)) throw new Error("项目尚未打开")
  if (kind === "project") return { kind: "project", projectPath: cwd }
  const open = getOpenSession(ctx.ws)
  if (!sessionId || open?.cwd !== cwd || open.sessionId !== sessionId) throw new Error("请先打开对应的 Pi 会话")
  return { kind: "session", projectPath: cwd, sessionId }
}

export async function listMemories(ctx: Ctx, cmd: Extract<ShellCommand, { t: "memory_list" }>) {
  const scopes: MemoryScope[] = [{ kind: "app" }]
  let cwd = ""
  if (cmd.cwd) {
    const project = await validatedScope(ctx, "project", cmd.cwd)
    if (!project || project.kind !== "project") return
    cwd = project.projectPath
    scopes.push(project)
    const open = getOpenSession(ctx.ws)
    if (cmd.sessionId && open?.cwd === cwd && open.sessionId === cmd.sessionId) {
      scopes.push({ kind: "session", projectPath: cwd, sessionId: cmd.sessionId })
    }
  }
  const memories = (await Promise.all(scopes.map(scope => repository().list(scope, { limit: 100 })))).flat()
  ctx.send({ t: "memory_snapshot", cwd, sessionId: cmd.sessionId ?? "", memories })
}

type Mutation = Extract<ShellCommand, { t: "memory_create" | "memory_update" | "memory_delete" }>
export async function mutateMemory(ctx: Ctx, cmd: Mutation) {
  try {
    const scope = await validatedScope(ctx, cmd.scope, cmd.cwd, cmd.sessionId)
    if (!scope) throw new Error("项目目录不可用")
    const repo = repository()
    if (cmd.t === "memory_create") {
      const memory = await repo.create({ scope, content: cmd.content, source: "manual" })
      ctx.send({ t: "memory_result", requestId: cmd.requestId, ok: true, message: "记忆已保存", memory })
    } else if (cmd.t === "memory_update") {
      const memory = await repo.update(scope, cmd.id, cmd.expectedRevision, cmd.content)
      ctx.send({ t: "memory_result", requestId: cmd.requestId, ok: Boolean(memory), message: memory ? "记忆已更新" : "记忆不存在", memory: memory ?? undefined })
    } else {
      const deleted = await repo.delete(scope, cmd.id, cmd.expectedRevision)
      ctx.send({ t: "memory_result", requestId: cmd.requestId, ok: deleted, message: deleted ? "记忆已删除" : "记忆不存在" })
    }
    await listMemories(ctx, { t: "memory_list", cwd: cmd.cwd ?? "", sessionId: cmd.sessionId })
  } catch (e) {
    ctx.send({ t: "memory_result", requestId: cmd.requestId, ok: false, message: (e as Error).message })
  }
}

export async function listMemorySuggestions(ctx: Ctx, cmd: Extract<ShellCommand, { t: "memory_list_suggestions" }>) {
  const project = await validatedScope(ctx, "project", cmd.cwd)
  if (project?.kind !== "project") return
  ctx.send({ t: "memory_suggestions", cwd: project.projectPath, suggestions: listSuggestions(project.projectPath) })
}

export async function resolveMemorySuggestion(ctx: Ctx, cmd: Extract<ShellCommand, { t: "memory_resolve_suggestion" }>) {
  try {
    const project = await validatedScope(ctx, "project", cmd.cwd)
    if (project?.kind !== "project") throw new Error("项目目录不可用")
    const suggestion = listSuggestions(project.projectPath).find(s => s.id === cmd.id)
    if (!suggestion) throw new Error("建议不存在或已处理")
    if (cmd.action === "reject") {
      await resolveSuggestion(cmd.id, "rejected")
      ctx.send({ t: "memory_result", requestId: cmd.requestId, ok: true, message: "已忽略此建议" })
    } else if (cmd.action === "accept") {
      const scope = await validatedScope(ctx, cmd.scope ?? suggestion.scope.kind, project.projectPath, cmd.sessionId)
      if (!scope) throw new Error("作用域不可用")
      const memory = await repository().create({ scope, content: cmd.content ?? suggestion.content, source: "inferred-confirmed" })
      await resolveSuggestion(cmd.id, "accepted")
      ctx.send({ t: "memory_result", requestId: cmd.requestId, ok: true, message: "建议已保存为记忆", memory })
      await listMemories(ctx, { t: "memory_list", cwd: project.projectPath, sessionId: cmd.sessionId })
    } else throw new Error("无效操作")
    ctx.send({ t: "memory_suggestions", cwd: project.projectPath, suggestions: listSuggestions(project.projectPath) })
  } catch (e) {
    ctx.send({ t: "memory_result", requestId: cmd.requestId, ok: false, message: (e as Error).message })
  }
}
