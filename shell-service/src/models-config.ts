// pi's provider catalog: ~/.pi/agent/models.json
//
// This is the ONLY place pi reads provider/model definitions from
// (dist/config.js getModelsPath() → <agentDir>/models.json; there is no
// project-level models.json). pi validates the whole file with TypeBox and
// rejects ALL providers if any entry is invalid, so writes are validated and
// read back before they are accepted.
import { getAgentDir } from "./paths.js"
import { join } from "node:path"
import { readJsonFile, mutateJsonFile, writeJsonAtomic, withFileLock } from "./atomic-write.js"

export type PiApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai"

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
}

export interface PiProviderDef {
  name?: string
  baseUrl?: string
  apiKey?: string
  api?: PiApi
  compat?: Record<string, unknown>
  headers?: Record<string, string>
  models?: PiModelDef[]
}

export interface ModelsConfig { providers: Record<string, PiProviderDef> }

export function getModelsPath(): string { return join(getAgentDir(), "models.json") }

/**
 * pi's built-in provider ids (docs/providers.md auth.json table). A provider
 * whose id is in this set needs no entries in models.json unless the user adds
 * extra models — pi's shipped catalog already supplies them.
 */
export const BUILTIN_PROVIDER_IDS = new Set([
  "anthropic", "ant-ling", "azure-openai-responses", "openai", "deepseek", "nvidia",
  "google", "amazon-bedrock", "mistral", "groq", "cerebras", "cloudflare-ai-gateway",
  "cloudflare-workers-ai", "xai", "openrouter", "vercel-ai-gateway", "zai",
  "zai-coding-cn", "opencode", "opencode-go", "radius", "huggingface", "fireworks",
  "together", "baseten", "kimi-coding", "minimax", "minimax-cn", "qwen-token-plan",
  "qwen-token-plan-individual", "qwen-token-plan-cn", "xiaomi", "xiaomi-token-plan-cn",
  "xiaomi-token-plan-ams", "xiaomi-token-plan-sgp", "ollama",
])

export function loadModelsConfig(): ModelsConfig {
  const raw = readJsonFile<Partial<ModelsConfig>>(getModelsPath())
  const providers = raw?.providers
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return { providers: {} }
  return { providers }
}

/**
 * Mirror the parts of pi's schema that would invalidate the whole file.
 * Returns an error code, or null when the config is safe to write.
 */
export function validateModelsConfig(cfg: ModelsConfig): string | null {
  if (!cfg || typeof cfg !== "object" || !cfg.providers || typeof cfg.providers !== "object" || Array.isArray(cfg.providers)) {
    return "invalid_providers_object"
  }
  const APIS = new Set<string>(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"])
  for (const [id, p] of Object.entries(cfg.providers)) {
    if (!id || id.includes("/") || /\s/.test(id)) return "invalid_provider_id"
    if (!p || typeof p !== "object") return "invalid_provider"
    if (p.api !== undefined && !APIS.has(p.api)) return "invalid_api"
    if (p.compat !== undefined && (typeof p.compat !== "object" || p.compat === null || Array.isArray(p.compat))) return "invalid_compat"
    if (p.models !== undefined) {
      if (!Array.isArray(p.models)) return "invalid_models"
      const builtin = BUILTIN_PROVIDER_IDS.has(id)
      for (const m of p.models) {
        if (!m || typeof m !== "object") return "invalid_model"
        if (typeof m.id !== "string" || !m.id.trim()) return "invalid_model_id"
        if (m.api !== undefined && !APIS.has(m.api)) return "invalid_api"
        if (m.cost !== undefined) {
          const c = m.cost
          if ([c.input, c.output, c.cacheRead, c.cacheWrite].some(v => typeof v !== "number")) return "invalid_cost"
        }
      }
      // pi requires baseUrl + api at provider or model level for non-built-in
      // providers that declare models.
      if (!builtin) {
        const providerOk = Boolean(p.baseUrl) && Boolean(p.api)
        const everyModelOk = p.models.every(m => Boolean(m.baseUrl ?? p.baseUrl) && Boolean(m.api ?? p.api))
        if (!providerOk && !everyModelOk) return "missing_base_url_or_api"
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
 * the file is re-read afterwards, so a schema mistake can never leave pi with an
 * unreadable catalog.
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
