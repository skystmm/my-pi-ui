// Provider + model commands. Everything here writes pi's native catalogs:
//   ~/.pi/agent/models.json  (provider/model definitions — global only in pi)
//   ~/.pi/agent/auth.json    (credentials, 0600, keyed by pi provider id)
// and then forces a fresh pi process so the next command sees the new catalog.
import { liveSessions } from "../pi-adapter/index.js"
import { mutateModelsConfig, verifyModelsConfigWritten, loadModelsConfig, ModelsConfigError, BUILTIN_PROVIDER_IDS, type PiProviderDef } from "../models-config.js"
import { storeApiKey, storeEnvKey, removeCredential, getApiKeyEntry } from "../credential-store.js"
import { API_BY_TYPE, DEFAULT_BASE_BY_TYPE, providerIdFor } from "../providers.js"
import { canonCwd } from "../project-scanner.js"
import { validateProviderInput, validateModelId, setDefaultModel as persistDefaultModel, setModelThinking } from "../settings-service.js"
import { providersSnapshot, modelsSnapshot } from "../snapshots.js"
import { probeProvider } from "../provider-probe.js"
import type { Ctx } from "./context.js"
import type { ProviderDraftInput, ModelDraftInput, ProviderType, ShellCommand, ThinkingLevel } from "../ws-protocol.js"

/** pi resolve: cli → auth.json → env → models.json apiKey. */
function compatFor(type: ProviderType): Record<string, unknown> | undefined {
  // Local OpenAI-compatible servers usually reject the `developer` role and
  // reasoning_effort; pi otherwise only auto-detects this from the URL.
  if (type === "ollama") return { supportsDeveloperRole: false, supportsReasoningEffort: false }
  return undefined
}

export async function upsertProvider(ctx: Ctx, cmd: Extract<ShellCommand, { t: "upsert_provider" }>) {
  const draft: ProviderDraftInput = cmd.provider
  const v = validateProviderInput({ name: draft.name, type: draft.type, baseUrl: draft.baseUrl, auth: draft.auth, apiKey: draft.apiKey })
  if (v) return ctx.fail(v, v)

  const providerId = providerIdFor(draft.name, draft.type)
  const api = API_BY_TYPE[draft.type]
  const baseUrl = draft.baseUrl?.trim() || DEFAULT_BASE_BY_TYPE[draft.type]
  const models: ModelDraftInput[] = (draft.models ?? []).filter(m => m.id.trim())
  for (const m of models) {
    const mv = validateModelId(m.id)
    if (mv) return ctx.fail(mv, `${m.id}: ${mv}`)
  }

  // Provider definitions live in models.json. pi's shipped catalog already
  // covers built-in providers, so only write an entry when we bring our own
  // models or the provider is custom/local.
  const needsProviderEntry = !isBuiltin(providerId) || models.length > 0
  try {
    await mutateModelsConfig((cur) => {
      if (!needsProviderEntry) return cur
      const prev: PiProviderDef = cur.providers[providerId] ?? {}
      const nextDef: PiProviderDef = { ...prev }
      if (draft.name.trim()) nextDef.name = draft.name.trim()
      const existingBase = prev.baseUrl
      if (baseUrl && (!isBuiltin(providerId) || baseUrl !== existingBase)) nextDef.baseUrl = baseUrl
      nextDef.api = api
      const compat = compatFor(draft.type)
      if (compat) nextDef.compat = { ...(prev.compat ?? {}), ...compat }
      if (draft.type === "ollama" && !nextDef.apiKey) nextDef.apiKey = "ollama" // placeholder; ollama ignores it
      if (models.length) {
        const merged = [...(prev.models ?? [])]
        for (const m of models) {
          const idx = merged.findIndex(x => x.id === m.id)
          const def = {
            id: m.id.trim(),
            name: m.displayName?.trim() || undefined,
            reasoning: m.reasoning,
            input: ["text"] as ("text" | "image")[],
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
          }
          const cleaned = Object.fromEntries(Object.entries(def).filter(([, val]) => val !== undefined))
          if (idx === -1) merged.push(cleaned as { id: string })
          else merged[idx] = { ...merged[idx], ...cleaned }
        }
        nextDef.models = merged
      }
      return { providers: { ...cur.providers, [providerId]: nextDef } }
    })
    if (!(await verifyModelsConfigWritten())) {
      return ctx.fail("save_failed", "models.json 写入后校验失败，已保留旧内容")
    }
  } catch (e) {
    const code = e instanceof ModelsConfigError ? e.code : "save_failed"
    return ctx.fail(code, (e as Error)?.message ?? "models.json 写入失败")
  }

  // Credentials: never in settings, never echoed back.
  try {
    if (draft.auth === "apiKey" && draft.apiKey?.trim()) await storeApiKey(providerId, draft.apiKey)
    else if (draft.auth === "env" && draft.envVar?.trim()) await storeEnvKey(providerId, draft.envVar)
  } catch (e) {
    return ctx.fail("save_failed", `auth.json 写入失败：${(e as Error)?.message ?? e}`)
  }

  // A long-lived pi process may not re-read models.json — respawn on next use.
  liveSessions.disposeAll()

  ctx.broadcast({ t: "providers_snapshot", providers: providersSnapshot() })
  ctx.broadcast({ t: "models_snapshot", models: modelsSnapshot() })
  ctx.send({ t: "provider_saved", providerId, name: draft.name.trim() || providerId, models: models.map(m => m.id) })
}

function isBuiltin(providerId: string): boolean {
  return BUILTIN_PROVIDER_IDS.has(providerId)
}

export async function removeProvider(ctx: Ctx, cmd: Extract<ShellCommand, { t: "remove_provider" }>) {
  const providerId = cmd.providerId
  const entry = getApiKeyEntry(providerId)
  try {
    await mutateModelsConfig((cur) => {
      if (!(providerId in cur.providers)) return cur
      const next = { ...cur.providers }
      delete next[providerId]
      return { providers: next }
    })
  } catch (e) {
    return ctx.fail(e instanceof ModelsConfigError ? e.code : "save_failed", (e as Error)?.message ?? "删除失败")
  }
  if (entry) {
    try { await removeCredential(providerId) }
    catch (e) { return ctx.fail("save_failed", `auth.json 删除失败：${(e as Error)?.message ?? e}`) }
  }
  liveSessions.disposeAll()
  ctx.broadcast({ t: "providers_snapshot", providers: providersSnapshot() })
  ctx.broadcast({ t: "models_snapshot", models: modelsSnapshot() })
}

export async function upsertModel(ctx: Ctx, cmd: Extract<ShellCommand, { t: "upsert_model" }>) {
  const mv = validateModelId(cmd.model.id)
  if (mv) return ctx.fail(mv, mv)
  const providerId = cmd.providerId
  if (!providerId) return ctx.fail("invalid_provider_id", "缺少 providerId")
  try {
    await mutateModelsConfig((cur) => {
      const prev = cur.providers[providerId]
      if (!prev) throw new ModelsConfigError("unknown_provider", `provider 不存在：${providerId}`)
      const m = cmd.model
      const def = Object.fromEntries(Object.entries({
        id: m.id.trim(),
        name: m.displayName?.trim() || undefined,
        reasoning: m.reasoning,
        input: ["text"] as ("text" | "image")[],
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
      }).filter(([, val]) => val !== undefined)) as { id: string }
      const models = [...(prev.models ?? [])]
      const idx = models.findIndex(x => x.id === def.id)
      if (idx === -1) models.push(def)
      else models[idx] = { ...models[idx], ...def }
      return { providers: { ...cur.providers, [providerId]: { ...prev, models } } }
    })
    if (!(await verifyModelsConfigWritten())) return ctx.fail("save_failed", "models.json 写入后校验失败")
  } catch (e) {
    return ctx.fail(e instanceof ModelsConfigError ? e.code : "save_failed", (e as Error)?.message ?? "写入失败")
  }
  liveSessions.disposeAll()
  ctx.broadcast({ t: "providers_snapshot", providers: providersSnapshot() })
  ctx.broadcast({ t: "models_snapshot", models: modelsSnapshot() })
}

export async function removeModel(ctx: Ctx, cmd: Extract<ShellCommand, { t: "remove_model" }>) {
  try {
    await mutateModelsConfig((cur) => {
      const prev = cur.providers[cmd.providerId]
      if (!prev) return cur
      const models = (prev.models ?? []).filter(m => m.id !== cmd.modelId)
      return { providers: { ...cur.providers, [cmd.providerId]: { ...prev, models } } }
    })
  } catch (e) {
    return ctx.fail(e instanceof ModelsConfigError ? e.code : "save_failed", (e as Error)?.message ?? "删除失败")
  }
  liveSessions.disposeAll()
  ctx.broadcast({ t: "providers_snapshot", providers: providersSnapshot() })
  ctx.broadcast({ t: "models_snapshot", models: modelsSnapshot() })
}

export async function testProvider(ctx: Ctx, cmd: Extract<ShellCommand, { t: "test_provider" }>) {
  if (typeof cmd.providerIdOrDraft === "string") {
    const providerId = cmd.providerIdOrDraft
    const def = loadModelsConfig().providers[providerId]
    const entry = getApiKeyEntry(providerId)
    const key = entry && !entry.key.startsWith("$") && !entry.key.startsWith("!") ? entry.key : undefined
    const type = (def ? typeFromApi(def.api) : "openai-compatible") as ProviderType
    const res = await probeProvider({ type, baseUrl: def?.baseUrl, apiKey: key })
    ctx.send({ t: "provider_test_result", providerId, ok: res.ok, latencyMs: res.latencyMs, error: res.ok ? undefined : { code: res.code ?? "unreachable", message: res.message ?? "" } })
    return
  }
  const draft = cmd.providerIdOrDraft
  const res = await probeProvider({ type: draft.type, baseUrl: draft.baseUrl, apiKey: draft.apiKey })
  ctx.send({ t: "provider_test_result", providerId: "draft", ok: res.ok, latencyMs: res.latencyMs, error: res.ok ? undefined : { code: res.code ?? "unreachable", message: res.message ?? "" } })
}

function typeFromApi(api: string | undefined): ProviderType {
  switch (api) {
    case "anthropic-messages": return "anthropic"
    case "google-generative-ai": return "google"
    default: return "openai-compatible"
  }
}

/** Ask pi which models it can actually use right now, and publish them. */
export async function listAvailableModels(ctx: Ctx, cmd: Extract<ShellCommand, { t: "list_available_models" }>) {
  const cwd = await ctx.cwdOrError(cmd.cwd, "请先打开项目目录")
  if (!cwd) return
  try {
    const adapter = liveSessions.getAdapter(cwd)
    const data = await adapter.getAvailableModels()
    const models = (data?.models ?? []).map(raw => {
      const m = raw as { provider?: unknown; id?: unknown; name?: unknown; contextWindow?: unknown; reasoning?: unknown }
      return {
        provider: String(m.provider ?? ""),
        id: String(m.id ?? ""),
        name: typeof m.name === "string" ? m.name : undefined,
        contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
        reasoning: typeof m.reasoning === "boolean" ? m.reasoning : undefined,
      }
    }).filter(m => m.provider && m.id)
    ctx.send({ t: "available_models", cwd, models })
    ctx.broadcast({ t: "models_snapshot", models: modelsSnapshot(models) })
  } catch (e) {
    ctx.fail("available_models_failed", (e as Error)?.message ?? "get_available_models failed")
  }
}

/** Persist pi's startup model defaults (settings.json) and switch the live session. */
export async function setDefaultModel(ctx: Ctx, cmd: Extract<ShellCommand, { t: "set_default_model" }>) {
  try {
    await persistDefaultModel(cmd.provider, cmd.modelId, cmd.thinking)
    if (cmd.thinking) await setModelThinking(`${cmd.provider}/${cmd.modelId}`, cmd.thinking)
  } catch (e) {
    return ctx.fail("save_failed", `settings.json 写入失败：${(e as Error)?.message ?? e}`)
  }
  if (cmd.cwd) {
    // adapters are keyed by the canonical cwd (open_project/create_session
    // canonicalize), so a raw "/tmp/..." from the client would miss the lookup
    const cwd = canonCwd(cmd.cwd)
    const adapter = liveSessions.peek(cwd)
    if (adapter) {
      try {
        await adapter.setModel(cmd.provider, cmd.modelId)
        ctx.send({ t: "model_changed", cwd, provider: cmd.provider, modelId: cmd.modelId, thinkingLevel: cmd.thinking ?? "" })
      } catch (e) {
        // pi rejects models without resolved auth — surface it instead of pretending
        ctx.fail("set_model_failed", (e as Error)?.message ?? "pi set_model 失败")
      }
    }
  }
  ctx.broadcast({ t: "providers_snapshot", providers: providersSnapshot() })
  ctx.broadcast({ t: "models_snapshot", models: modelsSnapshot() })
}
