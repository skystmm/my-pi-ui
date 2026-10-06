// UI-side catalog of provider presets. The wire/data types live in
// lib/ws-protocol.ts (generated) — this module only holds display metadata.
export type { ThinkingLevel, ProviderType, ProviderAccount, ModelEntry } from "./ws-protocol"
import type { ThinkingLevel, ProviderType } from "./ws-protocol"

export type ProviderPreset = {
  type: ProviderType
  label: string
  baseUrl?: string
  docsUrl?: string
  defaultModels: string[]
  hint: string
}

export const providerPresets: ProviderPreset[] = [
  { type: "azure", label: "Azure OpenAI", hint: "Azure endpoint /openai/v1", defaultModels: [], docsUrl: "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md#azure-openai" },
  { type: "anthropic", label: "Anthropic", hint: "claude-*.api.anthropic.com", baseUrl: "https://api.anthropic.com", defaultModels: [], docsUrl: "https://docs.anthropic.com" },
  { type: "openai", label: "OpenAI", hint: "api.openai.com", baseUrl: "https://api.openai.com/v1", defaultModels: [], docsUrl: "https://platform.openai.com" },
  { type: "google", label: "Google AI", hint: "generativelanguage.googleapis.com", baseUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModels: [], docsUrl: "https://ai.google.dev" },
  { type: "deepseek", label: "DeepSeek", hint: "api.deepseek.com", baseUrl: "https://api.deepseek.com/v1", defaultModels: ["deepseek-chat", "deepseek-reasoner"], docsUrl: "https://api-docs.deepseek.com" },
  { type: "moonshot", label: "Moonshot / Kimi", hint: "api.moonshot.cn", baseUrl: "https://api.moonshot.cn/v1", defaultModels: ["moonshot-v1-8k", "moonshot-v1-32k"], docsUrl: "https://platform.moonshot.cn" },
  { type: "ollama", label: "Ollama (local)", hint: "127.0.0.1:11434", baseUrl: "http://127.0.0.1:11434/v1", defaultModels: [], docsUrl: "https://ollama.com" },
  { type: "openai-compatible", label: "OpenAI 兼容", hint: "任意兼容 /v1 接口", defaultModels: [], docsUrl: "" },
]

export const thinkingLevels: { value: ThinkingLevel; label: string; note: string }[] = [
  { value: "off", label: "off", note: "不启用思考" },
  { value: "minimal", label: "minimal", note: "极简" },
  { value: "low", label: "low", note: "轻量" },
  { value: "medium", label: "medium", note: "默认" },
  { value: "high", label: "high", note: "深度" },
  { value: "xhigh", label: "xhigh", note: "超深" },
  { value: "max", label: "max", note: "最长" },
]
