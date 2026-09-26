// Extension + skill commands. pi loads resources from path arrays in
// settings.json (extensions/skills) and from npm/git packages (packages), so
// "enabled" == present in the array — that is pi's own toggle semantics.
import { liveSessions } from "../pi-adapter/index.js"
import { mutateSettings, validateExtensionInput, isPackageSource } from "../settings-service.js"
import { extensionsSnapshot, pathSkillsSnapshot, rpcSkillEntries } from "../snapshots.js"
import type { Ctx } from "./context.js"
import type { ShellCommand, SlashCommandEntry } from "../ws-protocol.js"

function trustFail(ctx: Ctx, e: unknown): boolean {
  const code = (e as { code?: string })?.code
  if (code === "trust_required") { ctx.fail("trust_required", "项目未信任：先在左侧信任该项目，再写入 .pi/settings.json"); return true }
  return false
}

async function skillsSnapshot(cwd?: string) {
  if (!cwd) return pathSkillsSnapshot()
  // pi's own command list is the authoritative skill inventory
  try {
    const adapter = liveSessions.getAdapter(cwd)
    const data = await adapter.getCommands()
    const commands = (data?.commands ?? []).map(raw => {
      const c = raw as { name?: unknown; description?: unknown; source?: unknown }
      return { name: String(c.name ?? ""), description: typeof c.description === "string" ? c.description : undefined, source: String(c.source ?? "") }
    }).filter(c => c.name)
    return [...pathSkillsSnapshot(cwd), ...rpcSkillEntries(commands)]
  } catch {
    return pathSkillsSnapshot(cwd) // adapter unavailable: path-configured skills still list
  }
}

export async function listExtensions(ctx: Ctx, cmd: Extract<ShellCommand, { t: "list_extensions" }>) {
  ctx.send({ t: "extensions_snapshot", extensions: extensionsSnapshot(cmd.cwd) })
}

export async function listSkills(ctx: Ctx, cmd: Extract<ShellCommand, { t: "list_skills" }>) {
  ctx.send({ t: "skills_snapshot", skills: await skillsSnapshot(cmd.cwd) })
}

export async function listSlashCommands(ctx: Ctx, cmd: Extract<ShellCommand, { t: "list_slash_commands" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  try {
    const data = await liveSessions.getAdapter(cwd).getCommands()
    const commands: SlashCommandEntry[] = (data?.commands ?? []).flatMap(raw => {
      const command = raw as { name?: unknown; description?: unknown; source?: unknown }
      if (typeof command.name !== "string" || !/^[^\s/]+$/.test(command.name)) return []
      if (command.source !== "extension" && command.source !== "prompt" && command.source !== "skill") return []
      return [{ name: command.name, description: typeof command.description === "string" ? command.description : undefined, source: command.source }]
    })
    ctx.send({ t: "slash_commands", cwd, commands })
  } catch (e) {
    ctx.fail("list_slash_commands_failed", (e as Error)?.message ?? "无法获取 pi 命令")
  }
}

export async function installExtension(ctx: Ctx, cmd: Extract<ShellCommand, { t: "install_extension" }>) {
  const v = validateExtensionInput({ source: cmd.source })
  if (v) return ctx.fail(v, v)
  const source = cmd.source.trim()
  const asPackage = isPackageSource(source)
  try {
    await mutateSettings(cmd.scope, cmd.cwd, (c) => asPackage
      ? { ...c, packages: c.packages.some(p => (typeof p === "string" ? p : String((p as { source?: unknown }).source)) === source) ? c.packages : [...c.packages, source] }
      : { ...c, extensions: c.extensions.includes(source) ? c.extensions : [...c.extensions, source] })
  } catch (e) {
    if (trustFail(ctx, e)) return
    return ctx.fail("save_failed", (e as Error)?.message ?? "写入失败")
  }
  broadcastCatalog(ctx, cmd.cwd)
}

export async function removeExtension(ctx: Ctx, cmd: Extract<ShellCommand, { t: "remove_extension" }>) {
  const source = cmd.source
  try {
    await mutateSettings(cmd.scope, cmd.cwd, (c) => ({
      ...c,
      extensions: c.extensions.filter(p => p !== source),
      packages: c.packages.filter(p => (typeof p === "string" ? p : String((p as { source?: unknown }).source)) !== source),
      skills: c.skills.filter(p => p !== source),
    }))
  } catch (e) {
    if (trustFail(ctx, e)) return
    return ctx.fail("save_failed", (e as Error)?.message ?? "删除失败")
  }
  broadcastCatalog(ctx, cmd.cwd)
}

/** pi toggles a resource by its presence in the settings array. */
export async function setExtensionEnabled(ctx: Ctx, cmd: Extract<ShellCommand, { t: "set_extension_enabled" }>) {
  const source = cmd.source
  const asPackage = isPackageSource(source)
  try {
    await mutateSettings(cmd.scope, cmd.cwd, (c) => {
      if (asPackage) {
        const has = c.packages.some(p => (typeof p === "string" ? p : String((p as { source?: unknown }).source)) === source)
        if (cmd.enabled && !has) return { ...c, packages: [...c.packages, source] }
        if (!cmd.enabled && has) return { ...c, packages: c.packages.filter(p => (typeof p === "string" ? p : String((p as { source?: unknown }).source)) !== source) }
        return c
      }
      const has = c.extensions.includes(source)
      if (cmd.enabled && !has) return { ...c, extensions: [...c.extensions, source] }
      if (!cmd.enabled && has) return { ...c, extensions: c.extensions.filter(p => p !== source) }
      return c
    })
  } catch (e) {
    if (trustFail(ctx, e)) return
    return ctx.fail("save_failed", (e as Error)?.message ?? "写入失败")
  }
  broadcastCatalog(ctx, cmd.cwd)
}

function broadcastCatalog(ctx: Ctx, cwd?: string) {
  ctx.broadcast({ t: "extensions_snapshot", extensions: extensionsSnapshot(cwd) })
  ctx.broadcast({ t: "skills_snapshot", skills: pathSkillsSnapshot(cwd) })
}

export async function invokeSkill(ctx: Ctx, cmd: Extract<ShellCommand, { t: "invoke_skill" }>) {
  // pi registers skills as slash commands; a skill is invoked like any prompt.
  try {
    const adapter = liveSessions.getAdapter(cmd.cwd)
    await adapter.prompt(`/skill:${cmd.skillId.replace(/^rpc:/, "")}`)
  } catch (e) {
    ctx.fail("invoke_skill_failed", (e as Error)?.message ?? "invoke failed")
  }
}

export async function extensionUiResponse(ctx: Ctx, cmd: Extract<ShellCommand, { t: "extension_ui_response" }>) {
  const cwd = cmd.cwd ?? ""
  if (!cwd) return ctx.fail("missing_cwd", "cwd required")
  const adapter = liveSessions.getAdapter(cwd)
  const payload: Record<string, unknown> = {}
  if (cmd.cancelled) payload["cancelled"] = true
  else if (cmd.result !== undefined) {
    if (typeof cmd.result === "string") payload["value"] = cmd.result
    else if (typeof cmd.result === "boolean") payload["confirmed"] = cmd.result
    else payload["value"] = String(cmd.result)
  }
  await adapter.respondExtensionUI(cmd.requestId, payload)
}

export async function extensionCommand(ctx: Ctx, cmd: Extract<ShellCommand, { t: "extension_command" }>) {
  const adapter = liveSessions.getAdapter(cmd.cwd)
  try {
    await (adapter as unknown as { sendRaw: (c: Record<string, unknown>) => Promise<unknown> })
      .sendRaw({ type: "extension_command", extensionId: cmd.extensionId, command: cmd.command, args: cmd.args })
  } catch (e) {
    ctx.fail("extension_command_failed", (e as Error)?.message ?? "extension command failed")
  }
}
