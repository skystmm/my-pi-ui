// Reachability probe behind the drawer's "Test Connection" button: a plain GET
// against the provider's model-listing endpoint, with error codes mapped to the
// same vocabulary as the save path.
import { DEFAULT_BASE_BY_TYPE } from "./providers.js"
import type { ProviderType } from "./ws-protocol.js"

export type ProbeResult = { ok: boolean; latencyMs: number; code?: string; message?: string }

const TIMEOUT_MS = 8000

function candidates(type: ProviderType, baseNorm: string, apiKey?: string): string[] {
  switch (type) {
    case "anthropic":
      return [`${baseNorm}/v1/models`, `${baseNorm}/models`, baseNorm]
    case "google": {
      const q = apiKey ? `?key=${encodeURIComponent(apiKey)}` : ""
      return [`${baseNorm}/models${q}`, `${baseNorm}/v1/models${q}`]
    }
    case "ollama":
      return [`${baseNorm}/models`, `${baseNorm.replace(/\/v1$/, "")}/api/tags`]
    default:
      return [`${baseNorm}/models`]
  }
}

function headersFor(type: ProviderType, apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" }
  if (!apiKey) return h
  if (type === "anthropic") { h["x-api-key"] = apiKey; h["anthropic-version"] = "2023-06-01" }
  else if (type === "google") h["x-goog-api-key"] = apiKey
  else h["Authorization"] = `Bearer ${apiKey}`
  return h
}

export async function probeProvider(input: { type: ProviderType; baseUrl?: string; apiKey?: string }): Promise<ProbeResult> {
  const start = Date.now()
  const rawBase = input.baseUrl?.trim()
  const baseUrl = rawBase || DEFAULT_BASE_BY_TYPE[input.type] || ""
  const apiKey = input.apiKey?.trim()
  if (!baseUrl) {
    return { ok: false, latencyMs: Date.now() - start, code: "invalid_base_url", message: "请填写 Base URL（或选择预设回落地址）" }
  }
  let baseNorm: string
  try { baseNorm = new URL(baseUrl).toString().replace(/\/$/, "") }
  catch { return { ok: false, latencyMs: Date.now() - start, code: "invalid_base_url", message: "Base URL 非法" } }

  const urls = candidates(input.type, baseNorm, apiKey)
  let lastStatus: number | null = null
  let lastStatusText = ""
  let lastErr = ""

  for (const url of urls) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      const res = await fetch(url, { headers: headersFor(input.type, apiKey), signal: ctrl.signal })
      clearTimeout(timer)
      if (res.ok) return { ok: true, latencyMs: Date.now() - start }
      lastStatus = res.status; lastStatusText = res.statusText
      if (res.status === 401 || res.status === 403) {
        return { ok: false, latencyMs: Date.now() - start, code: "auth_failed", message: `HTTP ${res.status} · 认证失败（线路已通，请检查 Key / 权限）` }
      }
      if (res.status === 404 && urls.length > 1) continue
      if (res.status === 404) {
        return { ok: false, latencyMs: Date.now() - start, code: "invalid_base_url", message: `HTTP 404 · 路径不存在（探 ${url}）· 多为 Base URL 少/多 /v1，请对照预设回落地址检查` }
      }
      return {
        ok: false, latencyMs: Date.now() - start,
        code: res.status >= 500 ? "upstream_error" : "model_not_found",
        message: `HTTP ${res.status} · ${res.statusText || "上游返回异常"}`,
      }
    } catch (e) {
      const m = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e)
      lastErr = m
      if (m === "timeout" || m.includes("AbortError")) {
        return { ok: false, latencyMs: Date.now() - start, code: "timeout", message: "请求超时（5-8s）· 请检查网络/代理" }
      }
      if (m.includes("ENOTFOUND") || m.includes("EAI_AGAIN") || m.includes("getaddrinfo")) {
        return { ok: false, latencyMs: Date.now() - start, code: "unreachable", message: "DNS/网络不可达 · 检查 Base URL 或代理" }
      }
      if (m.includes("ECONNREFUSED") || m.includes("fetch failed")) {
        return { ok: false, latencyMs: Date.now() - start, code: "unreachable", message: `连接被拒绝 · ${m.slice(0, 80)}` }
      }
      return { ok: false, latencyMs: Date.now() - start, code: "unreachable", message: m.slice(0, 120) }
    }
  }
  return {
    ok: false, latencyMs: Date.now() - start,
    code: "model_not_found",
    message: lastStatus != null ? `HTTP ${lastStatus} ${lastStatusText}` : (lastErr || "未知网络错误"),
  }
}
