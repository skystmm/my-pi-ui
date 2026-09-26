// GENERATED — do not edit. Source: shell-service/provider-map.ts
// Regenerate with: npm run sync:protocol
// Pure ProviderType ↔ pi provider id / api mapping — shared verbatim with the
// frontend (scripts/sync-protocol.mjs). No node imports here.
//
// pi's built-in provider ids come from docs/providers.md (the auth.json key
// table); `api` values come from docs/models.md ("Supported APIs"). The two must
// agree with models.json / auth.json keys or pi will never resolve the provider.

export type ProviderType =
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "moonshot"
  | "openai-compatible"
  | "ollama"
  | "custom"

export type PiApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai"

export const API_BY_TYPE: Record<ProviderType, PiApi> = {
  anthropic: "anthropic-messages",
  openai: "openai-completions",
  google: "google-generative-ai",
  deepseek: "openai-completions",
  moonshot: "openai-completions",
  "openai-compatible": "openai-completions",
  ollama: "openai-completions",
  custom: "openai-completions",
}

const BUILTIN_ID_BY_TYPE: Partial<Record<ProviderType, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  deepseek: "deepseek",
  ollama: "ollama",
}

const TYPE_BY_BUILTIN_ID: Record<string, ProviderType> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  deepseek: "deepseek",
  ollama: "ollama",
}

export const DEFAULT_BASE_BY_TYPE: Partial<Record<ProviderType, string>> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com/v1",
  moonshot: "https://api.moonshot.cn/v1",
  ollama: "http://127.0.0.1:11434/v1",
}

/** pi provider id: a built-in id when we have one, else a slug of the name. */
export function providerIdFor(name: string, type: ProviderType): string {
  const builtin = BUILTIN_ID_BY_TYPE[type]
  if (builtin) return builtin
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32)
  return slug || `custom-${Math.random().toString(36).slice(2, 6)}`
}

export function typeForProviderId(id: string): ProviderType {
  return TYPE_BY_BUILTIN_ID[id] ?? "custom"
}

export function hasBuiltinId(type: ProviderType): boolean {
  return BUILTIN_ID_BY_TYPE[type] !== undefined
}
