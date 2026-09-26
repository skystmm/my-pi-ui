// Provider/model domain glue between the UI's provider types and pi's native
// catalogs: translates ProviderType → pi provider id + api, and builds the
// providers/models snapshots the frontend renders.
import { BUILTIN_PROVIDER_IDS, loadModelsConfig, type PiApi } from "./models-config.js"
import { credentialSource, maskedKeyFor, getApiKeyEntry, readAuth } from "./credential-store.js"
import { loadSettings } from "./settings-service.js"
import type { ProviderAccount, ModelEntry, ThinkingLevel } from "./ws-protocol.js"
import { DEFAULT_BASE_BY_TYPE, providerIdFor, typeForProviderId, API_BY_TYPE } from "./provider-map.js"

export { DEFAULT_BASE_BY_TYPE, providerIdFor, typeForProviderId, API_BY_TYPE }

export function isBuiltinProvider(id: string): boolean { return BUILTIN_PROVIDER_IDS.has(id) }

/** Where a provider's credential comes from, mirrored into the account status. */
function statusFor(providerId: string, envRef: string | undefined): ProviderAccount["status"] {
  const src = credentialSource(providerId)
  if (src === "stored" || src === "env" || src === "command") return "connected"
  return envRef ? "missing_key" : "missing_key"
}

export function listProviders(): ProviderAccount[] {
  const cfg = loadModelsConfig()
  const seen = new Set<string>()
  const out: ProviderAccount[] = []

  for (const [id, def] of Object.entries(cfg.providers)) {
    seen.add(id)
    const entry = getApiKeyEntry(id)
    const envRef = entry && entry.key.startsWith("$") ? entry.key.slice(1) : undefined
    out.push({
      id,
      name: def.name?.trim() || id,
      type: typeForProviderId(id),
      baseUrl: def.baseUrl,
      apiKeyMasked: maskedKeyFor(id),
      auth: entry?.key.startsWith("$") ? "env" : "apiKey",
      envVar: envRef,
      status: statusFor(id, envRef),
      api: def.api,
      modelIds: (def.models ?? []).map(m => m.id),
    })
  }

  // Providers that exist only as a credential (a built-in pi catalog provider
  // the user just supplied a key for) still deserve a row in the drawer.
  for (const id of Object.keys(readAuth())) {
    if (seen.has(id) || !BUILTIN_PROVIDER_IDS.has(id)) continue
    const entry = getApiKeyEntry(id)
    if (!entry) continue
    out.push({
      id,
      name: id,
      type: typeForProviderId(id),
      apiKeyMasked: maskedKeyFor(id),
      auth: entry.key.startsWith("$") ? "env" : "apiKey",
      envVar: entry.key.startsWith("$") ? entry.key.slice(1) : undefined,
      status: "connected",
      modelIds: [],
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export type PiAvailableModel = {
  provider: string
  id: string
  name?: string
  contextWindow?: number
  reasoning?: boolean
}

/**
 * Models the UI can offer. `available` is pi's own answer (get_available_models
 * only lists models whose auth resolved), so a model present in models.json but
 * missing here is configured-but-unusable — shown greyed out, not hidden.
 */
export function listModels(available: PiAvailableModel[] = []): ModelEntry[] {
  const settings = loadSettings("global")
  const cfg = loadModelsConfig()
  const thinkingFor = (providerId: string, id: string): ThinkingLevel =>
    (settings.modelThinkingLevels?.[`${providerId}/${id}`] as ThinkingLevel | undefined) ?? "medium"

  const out = new Map<string, ModelEntry>()
  for (const m of available) {
    const key = `${m.provider}/${m.id}`
    out.set(key, {
      id: m.id,
      providerId: m.provider,
      displayName: m.name?.trim() || m.id,
      thinkingDefault: thinkingFor(m.provider, m.id),
      compat: [compatLabel(cfg.providers[m.provider]?.api)],
      pricing: "—",
      available: true,
      contextWindow: m.contextWindow,
    })
  }
  for (const [providerId, def] of Object.entries(cfg.providers)) {
    for (const m of def.models ?? []) {
      const key = `${providerId}/${m.id}`
      if (out.has(key)) continue
      out.set(key, {
        id: m.id,
        providerId,
        displayName: m.name?.trim() || m.id,
        thinkingDefault: thinkingFor(providerId, m.id),
        compat: [compatLabel(m.api ?? def.api)],
        pricing: pricingLabel(m.cost),
        available: false,
        contextWindow: m.contextWindow,
      })
    }
  }
  return [...out.values()]
}

function compatLabel(api: PiApi | undefined): string {
  switch (api) {
    case "anthropic-messages": return "anthropic-messages"
    case "google-generative-ai": return "google-generative-ai"
    case "openai-responses": return "openai-responses"
    default: return "openai-completions"
  }
}

function pricingLabel(cost: { input: number; output: number } | undefined): string {
  if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") return "—"
  if (cost.input === 0 && cost.output === 0) return "本地 · 免费"
  return `$${cost.input} / $${cost.output} per M`
}
