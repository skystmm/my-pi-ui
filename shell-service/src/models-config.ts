// pi's provider catalog: ~/.pi/agent/models.json
//
// Pi 1.0.4 also composes extension providers and remote catalog overlays.
// This module preserves their unknown configuration fields and performs
// structural checks before writing the user catalog.
import { getBuiltinProviders, getBuiltinModels, type BuiltinProvider } from "@earendil-works/pi-ai/providers/all"
import { getAgentDir } from "./paths.js"
import { join } from "node:path"
import { readJsonFile, mutateJsonFile, writeJsonAtomic, withFileLock } from "./atomic-write.js"

export type PiApi = string

export interface PiModelDef {
  id: string
  name?: string
  api?: PiApi
  baseUrl?: string
  reasoning?: boolean
  input?: ("text" | "image")[]
  contextWindow?: number
  maxTokens?: number
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  compat?: Record<string, unknown>
  [key: string]: unknown
}

export interface PiProviderDef {
  name?: string
  baseUrl?: string
  apiKey?: string
  api?: PiApi
  compat?: Record<string, unknown>
  headers?: Record<string, string>
  models?: PiModelDef[]
  modelOverrides?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

export interface ModelsConfig { providers: Record<string, PiProviderDef> }

export function getModelsPath(): string { return join(getAgentDir(), "models.json") }

/**
 * pi's built-in provider ids (docs/providers.md auth.json table). A provider
 * whose id is in this set needs no entries in models.json unless the user adds
 * extra models — pi's shipped catalog already supplies them.
 */
export const BUILTIN_PROVIDER_IDS = new Set<string>([...getBuiltinProviders(), "radius"])
const builtinModels = new Map(getBuiltinProviders().map(id => [id, getBuiltinModels(id)]))


export function loadModelsConfig(): ModelsConfig {
  const raw = readJsonFile<Partial<ModelsConfig>>(getModelsPath())
  const providers = raw?.providers
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return { providers: {} }
  return { providers }
}

/**
 * Validate the UI-managed structure and required provider defaults.
 * Unknown extension metadata remains intact; Pi validates its runtime semantics.
 */
export function validateModelsConfig(cfg: ModelsConfig): string | null {
  if (!cfg || typeof cfg !== "object" || !cfg.providers || typeof cfg.providers !== "object" || Array.isArray(cfg.providers)) {
    return "invalid_providers_object"
  }
  const validApi = (v: unknown) => typeof v === "string" && Boolean(v.trim())
  for (const [id, p] of Object.entries(cfg.providers)) {
    if (!id || id.includes("/") || /\s/.test(id)) return "invalid_provider_id"
    if (!p || typeof p !== "object") return "invalid_provider"
    if (p.api !== undefined && !validApi(p.api)) return "invalid_api"
    if (p.compat !== undefined && (typeof p.compat !== "object" || p.compat === null || Array.isArray(p.compat))) return "invalid_compat"
    if (p.models !== undefined) {
      if (!Array.isArray(p.models)) return "invalid_models"
      for (const m of p.models) {
        if (!m || typeof m !== "object") return "invalid_model"
        if (typeof m.id !== "string" || !m.id.trim()) return "invalid_model_id"
        if (m.api !== undefined && !validApi(m.api)) return "invalid_api"
        if (m.cost !== undefined) {
          const c = m.cost
          if ([c.input, c.output, c.cacheRead, c.cacheWrite].some(v => typeof v !== "number")) return "invalid_cost"
        }
      }
      // Match Pi's fallback to a built-in model's API and endpoint.
      const defaults = builtinModels.get(id as BuiltinProvider) ?? []
      for (const m of p.models) {
        const model = defaults.find(x => x.id === m.id) ?? defaults.find(x => x.api === (m.api ?? p.api)) ?? defaults.find(x => x.api === "openai-completions") ?? defaults[0]
        if (!(m.baseUrl ?? p.baseUrl ?? model?.baseUrl) || !(m.api ?? p.api ?? model?.api)) return "missing_base_url_or_api"
      }
    }
  }
  return null
}

export class ModelsConfigError extends Error {
  code: string
  constructor(code: string, message?: string) { super(message ?? code); this.code = code }
}

/**
 * Read-modify-write models.json. The candidate is validated before the write and
 * the file is re-read afterwards. Runtime API-specific validation belongs to Pi.
 */
export async function mutateModelsConfig(fn: (cur: ModelsConfig) => ModelsConfig): Promise<ModelsConfig> {
  const path = getModelsPath()
  return mutateJsonFile<ModelsConfig>(path, (cur) => {
    const base: ModelsConfig = cur && typeof cur.providers === "object" && cur.providers ? cur : { providers: {} }
    const next = fn(base)
    const bad = validateModelsConfig(next)
    if (bad) throw new ModelsConfigError(bad, `models.json 校验失败：${bad}`)
    return next
  }, { providers: {} })
}

/** Read back what was written and confirm pi can still parse it. */
export async function verifyModelsConfigWritten(): Promise<boolean> {
  const path = getModelsPath()
  await withFileLock(path, () => {}, `${JSON.stringify({ providers: {} }, null, 2)}\n`)
  const reread = readJsonFile<ModelsConfig>(path)
  if (!reread) return true // absent file == empty catalog for pi
  return validateModelsConfig(reread) === null
}

export function writeModelsConfigSync(cfg: ModelsConfig): void {
  const bad = validateModelsConfig(cfg)
  if (bad) throw new ModelsConfigError(bad, `models.json 校验失败：${bad}`)
  writeJsonAtomic(getModelsPath(), cfg)
}
