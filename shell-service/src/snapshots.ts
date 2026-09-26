// Snapshot builders for the settings-driven catalogs (providers/models come from
// pi's models.json + auth.json; extensions/skills from pi's settings.json).
import { basename } from "node:path"
import { loadSettings } from "./settings-service.js"
import { listProviders, listModels, type PiAvailableModel } from "./providers.js"
import type { ExtensionEntry, SkillEntry, ProviderAccount, ModelEntry } from "./ws-protocol.js"

export function providersSnapshot(): ProviderAccount[] { return listProviders() }

export function modelsSnapshot(available: PiAvailableModel[] = []): ModelEntry[] { return listModels(available) }

function nameForPath(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "")
  return basename(trimmed) || trimmed
}

function localEntry(path: string, scope: "global" | "project"): ExtensionEntry {
  return { id: `${scope}:${path}`, name: nameForPath(path), source: "local", path, scope, enabled: true }
}

function packageEntries(pkg: string | Record<string, unknown>, scope: "global" | "project"): { extensions: ExtensionEntry[]; skills: SkillEntry[] } {
  const source = typeof pkg === "string" ? pkg : String((pkg as { source?: unknown }).source ?? "")
  if (!source) return { extensions: [], skills: [] }
  const filter = typeof pkg === "string" ? null : pkg as { extensions?: unknown; skills?: unknown }
  const extFilter = Array.isArray(filter?.extensions) ? filter!.extensions as unknown[] : null
  const skillFilter = Array.isArray(filter?.skills) ? filter!.skills as unknown[] : null
  const base = { id: `${scope}:${source}`, name: source, source: "npm" as const, path: source, scope, enabled: true }
  return {
    extensions: extFilter && extFilter.length === 0 ? [] : [{ ...base, name: `${source}` }],
    skills: (skillFilter ?? []).map(s => ({
      id: `${scope}:${source}:${String(s)}`, name: String(s), path: source, scope,
      enabled: true, source: "package" as const,
    })),
  }
}

/**
 * Configured extension resources. Local paths live in `settings.extensions`,
 * npm/git packages in `settings.packages` — a path is enabled by being present,
 * which is exactly pi's own toggle semantics (remove == disable).
 */
export function extensionsSnapshot(cwd?: string): ExtensionEntry[] {
  const out: ExtensionEntry[] = []
  const collect = (scope: "global" | "project", settings: ReturnType<typeof loadSettings>) => {
    for (const p of settings.extensions) out.push(localEntry(p, scope))
    for (const pkg of settings.packages) out.push(...packageEntries(pkg, scope).extensions)
  }
  collect("global", loadSettings("global"))
  if (cwd) {
    try { collect("project", loadSettings("project", cwd)) }
    catch { /* untrusted project: its resources stay hidden until trusted */ }
  }
  return out
}

export function pathSkillsSnapshot(cwd?: string): SkillEntry[] {
  const out: SkillEntry[] = []
  const collect = (scope: "global" | "project", settings: ReturnType<typeof loadSettings>) => {
    for (const p of settings.skills) {
      out.push({ id: `${scope}:${p}`, name: nameForPath(p), path: p, scope, enabled: true, source: "path" })
    }
    for (const pkg of settings.packages) out.push(...packageEntries(pkg, scope).skills)
  }
  collect("global", loadSettings("global"))
  if (cwd) {
    try { collect("project", loadSettings("project", cwd)) }
    catch { /* untrusted project */ }
  }
  return out
}

/** Skills pi itself exposes as slash commands (rpc get_commands source:"skill"). */
export function rpcSkillEntries(commands: { name: string; description?: string; source: string }[]): SkillEntry[] {
  return commands
    .filter(c => c.source === "skill")
    .map(c => ({ id: `rpc:${c.name}`, name: c.name, enabled: true, source: "rpc" as const, description: c.description }))
}
