import type { ProviderType, ProviderAccount, ThinkingLevel } from "../../lib/ws-protocol"

export type { ProviderAccount, ModelEntry, ProviderType, ThinkingLevel } from "../../lib/ws-protocol"

export type SettingsScope = "global" | "project"

export type ProviderDraft = {
  name: string
  type: ProviderType
  baseUrl: string
  auth: ProviderAccount["auth"]
  apiKey: string
  envVar: string
}

export type ThinkingDraft = { level: ThinkingLevel }

// 与 Shell Service 的错误码对齐：invalid_provider_name / invalid_base_url /
// missing_api_key / invalid_model_id / trust_required
const MODEL_ID_RE = /^[a-z0-9._:/-]+$/i

export function validateProviderDraft(d: ProviderDraft): string | null {
  if (!d.name.trim()) return "请填写服务商名称"
  if (d.type === "openai-compatible" && !d.baseUrl.trim()) return "OpenAI 兼容需填写 Base URL"
  try {
    if (d.baseUrl.trim()) new URL(d.baseUrl.trim())
  } catch {
    return "Base URL 非法"
  }
  if (d.auth === "apiKey" && !d.apiKey.trim() && d.type !== "ollama") return "请填写 API Key"
  if (d.auth === "env" && !d.envVar.trim()) return "请填写环境变量名（如 OPENAI_API_KEY）"
  return null
}

export function validateModelId(id: string): string | null {
  if (!id.trim()) return null // 允许不填模型（仅建 provider）
  if (!MODEL_ID_RE.test(id.trim())) return "modelId 仅允许字母、数字、._:/-"
  return null
}
