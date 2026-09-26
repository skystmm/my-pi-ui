// pi's credential store: ~/.pi/agent/auth.json
//
// pi's own layout (dist/core/auth-storage.js) is:
//   { "<providerId>": { "type": "api_key", "key": "sk-..." } }
// with 0600 permissions and a proper-lockfile lock on the file. OAuth logins
// write different entry shapes into the same file — those entries are preserved
// verbatim; this module only ever touches the providers it owns.
//
// `key` supports literals, "$ENV_VAR" interpolation and "!command" execution
// (docs/providers.md), and resolution order is CLI → auth.json → env → models.json.
import { getAuthPath } from "./paths.js"
import { maskApiKey } from "./settings-service.js"
import { readJsonFile, mutateJsonFile } from "./atomic-write.js"

export type ApiKeyEntry = { type: "api_key"; key: string }

type AuthData = Record<string, unknown>

export function readAuth(): AuthData {
  return readJsonFile<AuthData>(getAuthPath()) ?? {}
}

export function getApiKeyEntry(providerId: string): ApiKeyEntry | null {
  const e = readAuth()[providerId] as Partial<ApiKeyEntry> | undefined
  if (e && e.type === "api_key" && typeof e.key === "string") return e as ApiKeyEntry
  return null
}

/** What an entry points at, for the UI's status badge. */
export function credentialSource(providerId: string): "stored" | "env" | "command" | "none" {
  const e = getApiKeyEntry(providerId)
  if (!e) return "none"
  if (e.key.startsWith("!")) return "command"
  if (e.key.startsWith("$")) return "env"
  return "stored"
}

/**
 * Mask for display. Keys written by pi_ui are never echoed back to the client —
 * the UI only ever sees first7••••••••last4 (or the env/command reference, which
 * is not a secret).
 */
export function maskedKeyFor(providerId: string, fallback = ""): string {
  const e = getApiKeyEntry(providerId)
  if (!e) return fallback
  if (e.key.startsWith("$") || e.key.startsWith("!")) return e.key
  return maskApiKey(e.key)
}

/** Store a literal API key the way pi looks it up. */
export async function storeApiKey(providerId: string, apiKey: string): Promise<void> {
  const key = apiKey.trim()
  if (!key) return
  await mutateJsonFile<AuthData>(getAuthPath(), (cur) => ({ ...cur, [providerId]: { type: "api_key", key } }))
}

/** Store a "$ENV_VAR" reference instead of the secret itself. */
export async function storeEnvKey(providerId: string, envVar: string): Promise<void> {
  const v = envVar.trim()
  if (!v) return
  const ref = v.startsWith("$") ? v : `$${v}`
  await mutateJsonFile<AuthData>(getAuthPath(), (cur) => ({ ...cur, [providerId]: { type: "api_key", key: ref } }))
}

export async function removeCredential(providerId: string): Promise<void> {
  await mutateJsonFile<AuthData>(getAuthPath(), (cur) => {
    if (!(providerId in cur)) return cur
    const next = { ...cur }
    delete next[providerId]
    return next
  })
}

/** Legacy pi_ui wrote `{ "<p_xxx>": { apiKey } }` — pi can never resolve those. */
export function listLegacyEntries(): string[] {
  return Object.entries(readAuth())
    .filter(([, v]) => {
      const e = v as { apiKey?: unknown; type?: unknown }
      return e && typeof e === "object" && typeof e.apiKey === "string" && e.type === undefined
    })
    .map(([k]) => k)
}

export async function dropCredentials(providerIds: string[]): Promise<void> {
  if (!providerIds.length) return
  await mutateJsonFile<AuthData>(getAuthPath(), (cur) => {
    const next = { ...cur }
    for (const id of providerIds) delete next[id]
    return next
  })
}
