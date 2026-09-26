import { existsSync } from "node:fs"
import { join } from "node:path"
import { getTrustState } from "./trust.js"
import { getSettingsPath } from "./paths.js"
import { readJsonFile, mutateJsonFile } from "./atomic-write.js"
import type { ThinkingLevel } from "./ws-protocol.js"

/**
 * The pi settings keys this service reads/writes. Everything else in the file
 * (compaction, theme, retry, …) is preserved untouched by the merge write.
 * Types follow docs/settings.md: extensions/skills/prompts/themes are arrays of
 * PATHS (glob + `!exclude` supported); npm resources live under `packages`.
 */
export type SettingsConfig = {
  extensions: string[]
  skills: string[]
  packages: (string | Record<string, unknown>)[]
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: string
  modelThinkingLevels?: Record<string, string>
}

export type SettingsScope = "global" | "project"

function projectSettingsPath(cwd: string) { return join(cwd, ".pi", "settings.json") }

export function settingsPathFor(scope: SettingsScope, cwd?: string): string {
  if (scope === "project") {
    if (!cwd) throw Object.assign(new Error("cwd required for project scope"), { code: "trust_required" })
    const trust = getTrustState(cwd)
    if (trust !== "trusted") {
      throw Object.assign(new Error(`Project not trusted: ${cwd}`), { code: "trust_required" })
    }
    return projectSettingsPath(cwd)
  }
  return getSettingsPath()
}

function pickStrings(o: unknown): string[] {
  return Array.isArray(o) ? o.filter((v): v is string => typeof v === "string") : []
}

export function loadSettings(scope: SettingsScope, cwd?: string): SettingsConfig {
  const j = readJsonFile<Record<string, unknown>>(settingsPathFor(scope, cwd))
  if (!j) return { extensions: [], skills: [], packages: [] }
  const packages = Array.isArray(j["packages"]) ? (j["packages"] as (string | Record<string, unknown>)[]) : []
  return {
    extensions: pickStrings(j["extensions"]),
    skills: pickStrings(j["skills"]),
    packages,
    defaultProvider: typeof j["defaultProvider"] === "string" ? j["defaultProvider"] : undefined,
    defaultModel: typeof j["defaultModel"] === "string" ? j["defaultModel"] : undefined,
    defaultThinkingLevel: typeof j["defaultThinkingLevel"] === "string" ? j["defaultThinkingLevel"] : undefined,
    modelThinkingLevels: (j["modelThinkingLevels"] && typeof j["modelThinkingLevels"] === "object" && !Array.isArray(j["modelThinkingLevels"]))
      ? (j["modelThinkingLevels"] as Record<string, string>)
      : undefined,
  }
}

/**
 * Atomic read-modify-write under pi's own file lock. Every mutation branch must
 * go through this: concurrent WS commands would otherwise interleave and the
 * last writer would silently drop the other's change.
 */
export async function mutateSettings(scope: SettingsScope, cwd: string | undefined, fn: (cur: SettingsConfig) => SettingsConfig): Promise<SettingsConfig> {
  const path = settingsPathFor(scope, cwd)
  const next = await mutateJsonFile<Record<string, unknown>>(path, (cur) => {
    const shaped: SettingsConfig = {
      extensions: pickStrings(cur["extensions"]),
      skills: pickStrings(cur["skills"]),
      packages: Array.isArray(cur["packages"]) ? (cur["packages"] as (string | Record<string, unknown>)[]) : [],
      defaultProvider: typeof cur["defaultProvider"] === "string" ? cur["defaultProvider"] : undefined,
      defaultModel: typeof cur["defaultModel"] === "string" ? cur["defaultModel"] : undefined,
      defaultThinkingLevel: typeof cur["defaultThinkingLevel"] === "string" ? cur["defaultThinkingLevel"] : undefined,
      modelThinkingLevels: (cur["modelThinkingLevels"] && typeof cur["modelThinkingLevels"] === "object" && !Array.isArray(cur["modelThinkingLevels"]))
        ? (cur["modelThinkingLevels"] as Record<string, string>)
        : undefined,
    }
    const updated = fn(shaped)
    const out: Record<string, unknown> = { ...cur }
    out["extensions"] = updated.extensions
    out["skills"] = updated.skills
    if (updated.packages.length || "packages" in cur) out["packages"] = updated.packages
    if (updated.defaultProvider !== undefined) out["defaultProvider"] = updated.defaultProvider
    if (updated.defaultModel !== undefined) out["defaultModel"] = updated.defaultModel
    if (updated.defaultThinkingLevel !== undefined) out["defaultThinkingLevel"] = updated.defaultThinkingLevel
    if (updated.modelThinkingLevels !== undefined) out["modelThinkingLevels"] = updated.modelThinkingLevels
    return out
  })
  return loadSettings(scope, cwd) ?? next
}

/** pi's per-model thinking override key: "<provider>/<modelId>". */
export async function setDefaultModel(provider: string, modelId: string, thinking?: ThinkingLevel): Promise<void> {
  await mutateSettings("global", undefined, (c) => ({
    ...c,
    defaultProvider: provider,
    defaultModel: modelId,
    defaultThinkingLevel: thinking ?? c.defaultThinkingLevel,
  }))
}

export async function setModelThinking(modelKey: string, level: ThinkingLevel): Promise<void> {
  await mutateSettings("global", undefined, (c) => ({
    ...c,
    modelThinkingLevels: { ...(c.modelThinkingLevels ?? {}), [modelKey]: level },
  }))
}

/** mirrors pi settings-manager: settings.compaction?.reserveTokens ?? 16384. */
export function getCompactionReserveTokens(cwd?: string): number {
  const pick = (o: Record<string, unknown> | null): number | undefined => {
    const c = o?.["compaction"]
    if (!c || typeof c !== "object") return undefined
    const v = (c as Record<string, unknown>)["reserveTokens"]
    return typeof v === "number" && v > 0 ? v : undefined
  }
  let v = pick(readJsonFile<Record<string, unknown>>(getSettingsPath()))
  if (cwd) {
    const p = projectSettingsPath(cwd)
    if (existsSync(p)) v = pick(readJsonFile<Record<string, unknown>>(p)) ?? v
  }
  return v ?? 16384
}

export function maskApiKey(key: string): string {
  if (!key) return ""
  if (key.length <= 11) return key.slice(0, 3) + "••••••••" + key.slice(-2)
  return key.slice(0, 7) + "••••••••" + key.slice(-4)
}

// ---------------------------------------------------------------- validation

const MODEL_ID_RE = /^[a-z0-9._:/-]+$/i

export function validateProviderInput(input: { name: string; baseUrl?: string; auth: string; apiKey?: string; type?: string }): string | null {
  if (!input.name.trim()) return "invalid_provider_name"
  if (input.baseUrl?.trim()) {
    try { new URL(input.baseUrl.trim()) } catch { return "invalid_base_url" }
  }
  const isLocal = input.type === "ollama"
  if (input.auth === "apiKey" && !input.apiKey?.trim() && !isLocal) return "missing_api_key"
  if (input.auth === "env" && !isLocal && !input.name.trim()) return "invalid_provider_name"
  return null
}

export function validateModelId(id: string): string | null {
  if (!id.trim()) return null
  if (!MODEL_ID_RE.test(id.trim())) return "invalid_model_id"
  return null
}

/**
 * pi accepts a local path (relative to the settings file, absolute, or ~) or an
 * npm/git package name; npm resources belong under `packages`, not `extensions`.
 */
export function validateExtensionInput(input: { source: string }): string | null {
  const s = input.source?.trim()
  if (!s) return "invalid_source"
  if (s.startsWith(".") || s.startsWith("/") || s.startsWith("~")) return null
  if (/^[a-z0-9@._/-]+$/.test(s)) return null
  try { new URL(s); return null } catch { return "invalid_source" }
}

export function isPackageSource(source: string): boolean {
  const s = source.trim()
  return !(s.startsWith(".") || s.startsWith("/") || s.startsWith("~"))
}
