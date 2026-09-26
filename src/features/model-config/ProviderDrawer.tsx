import { useEffect, useState } from "react"
import { providerPresets, thinkingLevels, type ModelEntry, type ProviderType, type ThinkingLevel } from "../../lib/modelCatalog"
import { validateProviderDraft, validateModelId, type ProviderDraft } from "./types"
import { wsClient } from "../../lib/ws-client"
import { API_BY_TYPE, providerIdFor } from "../../lib/provider-map"
import type { ProviderAccount } from "../../lib/ws-protocol"

const statusLabel: Record<ProviderAccount["status"], { dot: string; label: string }> = {
  connected: { dot: "bg-emerald-500", label: "已配置凭据" },
  missing_key: { dot: "bg-amber-500", label: "未配置凭据" },
  error: { dot: "bg-red-500", label: "异常" },
}

function probePath(type: string, base?: string) {
  const b = (base ?? "").replace(/\/$/, "")
  if (type === "anthropic") return `${b || "https://api.anthropic.com"}/v1/models`
  if (type === "google") return `${b || "https://generativelanguage.googleapis.com/v1beta"}/models`
  if (type === "ollama") return `${b || "http://127.0.0.1:11434/v1"}/models （回落 /api/tags）`
  return `${b || "https://api.openai.com/v1"}/models`
}

function hintFor(code?: string) {
  switch (code) {
    case "invalid_base_url": return "请填 Base URL：Anthropic 填 https://api.anthropic.com；OpenAI/DeepSeek/Moonshot 填对应 /v1；Ollama 填 http://127.0.0.1:11434/v1；自建网关填你的网关地址。"
    case "missing_api_key": return "Ollama 本地可空，其余需填 API Key；填写后请确认 Key 与 Base URL 同源。"
    case "shell_disconnected": return "前端 WS 未连到 Shell Service（vite proxy /ws → 127.0.0.1:5174），请检查 5174 是否被占用。"
    case "auth_failed": return "网络可达但认证失败（401/403），多为 Key 与 Base URL 不匹配、Key 过期或需要组织/项目权限。"
    case "timeout": return "8s 超时未响应，常见为网络/代理阻断、Base URL 填错、或本机无法直连该域名。"
    case "unreachable": return "DNS 或 TCP 不可达，请检查 Base URL 拼写、代理与防火墙；可先在终端 curl -i {base}/models 验连通性。"
    case "upstream_error": return "上游 5xx，服务暂时不可用，稍后重试；若自建网关请查看网关日志。"
    case "model_not_found": return "HTTP 4xx 非认证错误，多为路径错误（少/多 /v1）或网关转发规则不匹配。"
    default: return "请核对 类型 × Base URL × Key 是否同源，Ollama 本地请确认 ollama serve 已启动。"
  }
}
function typeLabel(d: { code?: string } | null) { return d?.code === "auth_failed" ? "认证失败但线路已通" : "可达" }

type PendingModel = { id: string; displayName: string; thinking: ThinkingLevel }

type Props = {
  open: boolean
  onClose: () => void
  providers: ProviderAccount[]
  models: ModelEntry[]
  onAddProvider: (draft: ProviderDraft, models: PendingModel[], apiKey?: string) => void
  onRemoveProvider: (id: string) => void
}

export function ProviderDrawer({ open, onClose, providers, models, onAddProvider, onRemoveProvider }: Props) {
  const [providerPreset, setProviderPreset] = useState<ProviderType>("openai-compatible")
  const [providerName, setProviderName] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [authType, setAuthType] = useState<ProviderAccount["auth"]>("apiKey")
  const [apiKey, setApiKey] = useState("")
  const [envVar, setEnvVar] = useState("")
  const [pending, setPending] = useState<PendingModel[]>([])
  const [newModelId, setNewModelId] = useState("")
  const [newModelDisplay, setNewModelDisplay] = useState("")
  const [newThinking, setNewThinking] = useState<ThinkingLevel>("medium")
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle")
  const [testDetail, setTestDetail] = useState<{ code?: string; message?: string; latencyMs?: number } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const preset = providerPresets.find(p => p.type === providerPreset)!

  useEffect(() => { setTestDetail(null) }, [providerPreset, baseUrl, apiKey])
  useEffect(() => { if (open) { setFormError(null) } }, [open])

  if (!open) return null

  const providerId = providerIdFor(providerName || preset.label, providerPreset)

  const handleTest = () => {
    setFormError(null)
    if (authType === "apiKey" && !apiKey.trim() && providerPreset !== "ollama") {
      setTestDetail({ code: "missing_api_key", message: "请先填 API Key（Ollama 本地可空）" }); setTestState("fail"); return
    }
    if (!wsClient.ready) {
      setTestDetail({ code: "shell_disconnected", message: "Shell Service 未连接（127.0.0.1:5174）· 请确认已启动或刷新页面" }); setTestState("fail"); return
    }
    setTestState("testing"); setTestDetail(null)
    wsClient.send({ t: "test_provider", providerIdOrDraft: { type: providerPreset, baseUrl: baseUrl.trim() || preset.baseUrl, apiKey: apiKey.trim() || undefined } })
    let done = false
    const off = wsClient.on(ev => {
      if (ev.t === "provider_test_result" && !done) {
        done = true
        setTestState(ev.ok ? "ok" : "fail")
        setTestDetail({ code: ev.error?.code, message: ev.error?.message, latencyMs: ev.latencyMs })
        off(); clearTimeout(to)
      }
    })
    const to = window.setTimeout(() => {
      if (!done) {
        done = true; off()
        setTestState(prev => prev === "testing" ? "fail" : prev)
        setTestDetail(prev => prev ?? { code: "timeout", message: "前端 10s 未收到回包（Shell Service 超时 8s）· 检查网络/代理或 Base URL 是否可达", latencyMs: 10000 })
      }
    }, 10000)
  }

  const addPendingModel = () => {
    const mv = validateModelId(newModelId)
    if (mv) { setFormError(`modelId 非法：${mv}`); return }
    const id = newModelId.trim()
    if (!id) { setFormError("请填写 modelId"); return }
    if (pending.some(m => m.id === id)) { setFormError(`${id} 已在列表里`); return }
    setPending(prev => [...prev, { id, displayName: newModelDisplay.trim() || id, thinking: newThinking }])
    setNewModelId(""); setNewModelDisplay(""); setFormError(null)
  }

  const handleSave = () => {
    const draft = { name: providerName, type: providerPreset, baseUrl, auth: authType, apiKey, envVar }
    const v = validateProviderDraft(draft as never)
    if (v) { setFormError(v); return }
    setFormError(null)
    onAddProvider(draft as ProviderDraft, pending, apiKey.trim() || undefined)
    setProviderName(""); setBaseUrl(""); setApiKey(""); setEnvVar(""); setPending([]); setNewModelId(""); setNewModelDisplay("")
    setTestState("idle"); setTestDetail(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div data-drawer-close onClick={onClose} className="flex-1 bg-black/50 backdrop-blur-[1px]" />
      <div className="w-[560px] max-w-[92vw] h-full border-l flex flex-col shadow-2xl" style={{ background: "var(--bg)", borderColor: "var(--border)", boxShadow: "-16px 0 48px rgba(0,0,0,0.6)" }}>
        <div className="h-[48px] flex items-center gap-3 px-4 border-b shrink-0" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
          <span className="text-[13px] font-medium">模型与服务商</span>
          <span className="mono text-[11px] px-1.5 py-0.5 rounded border text-zinc-400" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>{providers.length} providers · {models.length} models</span>
          <span className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="w-7 h-7 grid place-items-center rounded hover:bg-[var(--bg-hover)] text-zinc-400">✕</button>
          </span>
        </div>

        <div className="flex-1 overflow-auto">
          <div className="px-4 pt-4">
            <div className="rounded-lg border px-3 py-2 mono text-[11px] leading-relaxed text-zinc-400" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              写入 pi 原生目录：<span className="text-zinc-200">~/.pi/agent/models.json</span>（provider/model 定义）+
              <span className="text-zinc-200"> auth.json</span>（凭据，0600，仅后端持有，前端只见掩码）。
              pi 没有项目级 models.json，因此服务商与模型始终是全局配置。
            </div>
          </div>

          <div className="px-4 pt-5">
            <div className="mono text-[11px] font-medium tracking-wide text-zinc-500 mb-2">已在 pi 中配置</div>
            <div className="space-y-2">
              {providers.length === 0 && (
                <div className="mono text-[11px] text-zinc-600 px-2 py-3 rounded border border-dashed text-center" style={{ borderColor: "var(--border)" }}>
                  尚无服务商 · pi 此刻没有可用模型
                </div>
              )}
              {providers.map(p => (
                <div key={p.id} className="rounded-lg border p-3 flex items-start gap-3" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
                  <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${statusLabel[p.status].dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-medium">{p.name}</span>
                      <span className="mono text-[10px] px-1 py-0.5 rounded border text-zinc-400" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>pi id · {p.id}</span>
                      <span className="mono text-[11px] text-zinc-500">{statusLabel[p.status].label}</span>
                      {p.apiKeyMasked && <span className="mono text-[11px] px-1.5 py-0.5 rounded border text-zinc-400" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>{p.apiKeyMasked}</span>}
                    </div>
                    {p.baseUrl && <div className="mono text-[11px] text-zinc-500 truncate mt-1">{p.baseUrl}</div>}
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {(models.filter(m => m.providerId === p.id).length ? models.filter(m => m.providerId === p.id).map(m => (
                        <span key={m.id} className={`mono text-[10px] px-1.5 py-0.5 rounded border ${m.available === false ? "text-amber-300/80 border-amber-500/20" : "text-zinc-400"}`} style={{ borderColor: m.available === false ? undefined : "var(--border)", background: "var(--bg)" }}>
                          {m.id}{m.available === false ? " · 未就绪" : ""}
                        </span>
                      )) : <span className="mono text-[11px] text-zinc-600">模型来自 pi 内置目录，打开项目后拉取</span>)}
                    </div>
                  </div>
                  <button
                    onClick={() => onRemoveProvider(p.id)}
                    className="mono text-[11px] px-2 py-1 rounded border hover:bg-[var(--bg-hover)] text-zinc-500 hover:text-zinc-300 shrink-0"
                    style={{ borderColor: "var(--border)", background: "var(--bg)" }}
                  >移除</button>
                </div>
              ))}
            </div>
          </div>

          <div className="px-4 pt-6">
            <div className="mono text-[11px] font-medium tracking-wide text-zinc-500 mb-2">添加到 pi</div>
            <div className="rounded-xl border p-4 space-y-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              <div>
                <label className="mono text-[11px] text-zinc-400">服务商类型</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
                  {providerPresets.map(pr => (
                    <button
                      key={pr.type}
                      onClick={() => { setProviderPreset(pr.type); if (pr.baseUrl) setBaseUrl(pr.baseUrl); setTestState("idle") }}
                      className={`text-left px-2.5 py-2 rounded-lg border ${providerPreset === pr.type ? "bg-[var(--bg-muted)] border-[var(--border-strong)]" : "border-[var(--border)] hover:bg-[var(--bg-hover)]"}`}
                    >
                      <div className="text-[12px] font-medium leading-none">{pr.label}</div>
                      <div className="mono text-[10px] text-zinc-500 truncate mt-1">{pr.hint}</div>
                    </button>
                  ))}
                </div>
                {preset.type === "openai-compatible" && (
                  <div className="mono text-[11px] text-zinc-600 mt-2 leading-relaxed">任意兼容 OpenAI /v1 的网关（OneAPI / LiteLLM / 自建代理），需填写 Base URL 与 modelId</div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="mono text-[11px] text-zinc-400">显示名称 *</span>
                  <input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder={preset.label} className="w-full px-2.5 py-2 rounded-lg border bg-[var(--bg)] mono text-[13px] placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" style={{ borderColor: "var(--border)" }} />
                </label>
                <label className="space-y-1">
                  <span className="mono text-[11px] text-zinc-400">Base URL {(preset.type === "openai-compatible" || preset.type === "ollama") ? "*" : "(可选)"}</span>
                  <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={preset.baseUrl ?? "https://api.example.com/v1"} className="w-full px-2.5 py-2 rounded-lg border bg-[var(--bg)] mono text-[12px] placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" style={{ borderColor: "var(--border)" }} />
                </label>
              </div>

              <div className="rounded-lg border px-3 py-2 mono text-[11px] leading-relaxed text-zinc-500" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
                pi provider id = <span className="text-zinc-200">{providerId}</span> · api = <span className="text-zinc-200">{API_BY_TYPE[providerPreset]}</span>
                <div className="text-zinc-600 mt-1">内置服务商（Anthropic / OpenAI / Google / DeepSeek / Ollama）直接用 pi 自带 id 与模型目录；其余按名称生成 id，模型定义写入 models.json。</div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="mono text-[11px] text-zinc-400">凭据</span>
                  <div className="flex gap-1 p-1 rounded-lg border" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
                    {(["apiKey", "oauth", "env"] as const).map(a => (
                      <button key={a} onClick={() => setAuthType(a)} className={`px-2.5 py-1 rounded-md mono text-[11px] border ${authType === a ? "bg-[var(--bg-muted)] border-[var(--border-strong)] text-zinc-200" : "border-transparent text-zinc-500"}`}>
                        {a === "apiKey" ? "API Key" : a === "oauth" ? "OAuth" : "环境变量"}
                      </button>
                    ))}
                  </div>
                  <span className="mono text-[10px] text-zinc-600 ml-auto">写入 auth.json · 前端仅见掩码</span>
                </div>
                {authType === "apiKey" && (
                  <input value={apiKey} onChange={e => { setApiKey(e.target.value); setTestState("idle") }} placeholder="sk-... / sk-ant-..." type="password" className="w-full px-2.5 py-2 rounded-lg border bg-[var(--bg)] mono text-[13px] placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" style={{ borderColor: "var(--border)" }} />
                )}
                {authType === "env" && (
                  <div className="space-y-1">
                    <input value={envVar} onChange={e => setEnvVar(e.target.value)} placeholder="OPENAI_API_KEY / ANTHROPIC_API_KEY" className="w-full px-2.5 py-2 rounded-lg border bg-[var(--bg)] mono text-[12px] placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" style={{ borderColor: "var(--border)" }} />
                    <div className="mono text-[10px] text-zinc-600">写入 auth.json 的 key 为 <span className="text-zinc-400">${"{VAR}"}</span>，由 pi 在运行时解析环境变量，明文不入盘。</div>
                  </div>
                )}
                {authType === "oauth" && (
                  <div className="rounded-lg border px-3 py-2.5 mono text-[11px] leading-relaxed text-zinc-400" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
                    OAuth 需在 pi 内执行 <span className="text-zinc-200">/login</span>（凭据落在同一 auth.json）。此抽屉不做 PKCE 代理，避免与 pi 的刷新锁冲突。
                  </div>
                )}
                {preset.docsUrl && <a href={preset.docsUrl} target="_blank" rel="noreferrer" className="mono text-[11px] text-zinc-500 hover:text-zinc-300 underline decoration-zinc-700">查看 {preset.label} 文档 ↗</a>}
              </div>

              <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2">
                  <span className="mono text-[11px] font-medium tracking-wide text-zinc-500">模型</span>
                  <span className="mono text-[11px] text-zinc-600">留空则用 pi 内置目录；自建网关请手填 modelId</span>
                </div>
                {pending.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pending.map(m => (
                      <span key={m.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border mono text-[11px] text-zinc-300" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
                        {m.id} · {m.thinking}
                        <button onClick={() => setPending(prev => prev.filter(x => x.id !== m.id))} className="text-zinc-500 hover:text-zinc-200">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="mono text-[11px] text-zinc-400">modelId</span>
                    <input value={newModelId} onChange={e => setNewModelId(e.target.value)} placeholder="如 gemma4:e4b / gpt-5 / my-model" list="preset-models" className="w-full px-2.5 py-2 rounded-lg border bg-[var(--bg)] mono text-[12px] placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" style={{ borderColor: "var(--border)" }} />
                    <datalist id="preset-models">
                      {preset.defaultModels.map(m => <option key={m} value={m} />)}
                      {models.slice(0, 8).map(m => <option key={`${m.providerId}/${m.id}`} value={m.id} />)}
                    </datalist>
                  </label>
                  <label className="space-y-1">
                    <span className="mono text-[11px] text-zinc-400">显示名</span>
                    <input value={newModelDisplay} onChange={e => setNewModelDisplay(e.target.value)} placeholder="可选，默认同 modelId" className="w-full px-2.5 py-2 rounded-lg border bg-[var(--bg)] mono text-[13px] placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600" style={{ borderColor: "var(--border)" }} />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mono text-[11px] text-zinc-400">Thinking 默认</span>
                  <div className="flex gap-1 flex-wrap">
                    {thinkingLevels.map(t => (
                      <button key={t.value} onClick={() => setNewThinking(t.value)} className={`px-2 py-1 rounded-full mono text-[11px] border ${newThinking === t.value ? "bg-white text-black border-white" : "border-[var(--border)] text-zinc-400 hover:text-zinc-200 hover:bg-[var(--bg-hover)]"}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <button onClick={addPendingModel} className="ml-auto px-2.5 py-1.5 rounded-md border mono text-[11px] hover:bg-[var(--bg-hover)]" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>+ 加入本次保存</button>
                </div>
              </div>

              <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2 justify-between">
                  <span className="mono text-[11px] font-medium tracking-wide text-zinc-500">连接探测</span>
                  <span className={`mono text-[10px] px-1.5 py-0.5 rounded-full border ${wsClient.ready ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" : "bg-amber-500/10 text-amber-300 border-amber-500/20"}`}>{wsClient.ready ? "WS 已连接 · /ws→127.0.0.1:5174" : "WS 未连接 · 请启动 Shell Service"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleTest}
                    disabled={testState === "testing"}
                    className="px-4 py-2 rounded-lg border mono text-[12px] font-medium hover:bg-[var(--bg-hover)] disabled:opacity-60 flex items-center gap-1.5 shrink-0"
                    style={{ borderColor: "var(--border)", background: "var(--bg)" }}
                  >
                    {testState === "testing" ? <><span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" /> 测试中… 8s 超时</> : "Test Connection"}
                  </button>
                  {testState === "ok" && <span className="mono text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">✓ 可达{testDetail?.latencyMs ? ` · ${testDetail.latencyMs}ms` : ""} · {typeLabel(testDetail)}</span>}
                  {testState === "fail" && <span className="mono text-[11px] px-2.5 py-1 rounded-full bg-red-500/15 text-red-300 border border-red-500/20">✕ {testDetail?.code ?? "连接失败"}{testDetail?.latencyMs ? ` · ${testDetail.latencyMs}ms` : ""}</span>}
                  <span className="mono text-[10px] text-zinc-600">不落盘，仅以草稿探测对应 Base URL</span>
                </div>
                {testDetail && testState !== "idle" && (
                  <div className={`rounded-lg border p-3 mono text-[11px] leading-relaxed ${testState === "ok" ? "bg-emerald-500/5 border-emerald-500/15 text-emerald-200" : "bg-red-500/5 border-red-500/15 text-red-200"}`} style={{ borderColor: testState === "ok" ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)" }}>
                    <div className="flex gap-2 flex-wrap items-baseline">
                      <span className="font-medium">{testDetail.code ?? (testState === "ok" ? "ok" : "fail")}</span>
                      {testDetail.message && <span className="opacity-80">· {testDetail.message}</span>}
                      {testDetail.latencyMs != null && <span className="opacity-60">· {testDetail.latencyMs}ms</span>}
                    </div>
                    {testState === "fail" && <div className="mt-1 opacity-80">{hintFor(testDetail.code)}</div>}
                  </div>
                )}
                {!testDetail && testState === "idle" && <div className="mono text-[11px] text-zinc-600 leading-relaxed">按当前「类型 × Base URL × Key」发起 <span className="text-zinc-400">{probePath(preset.type, baseUrl || preset.baseUrl)}</span> GET；Anthropic 走 <span className="text-zinc-400">x-api-key</span>，Google 走 <span className="text-zinc-400">x-goog-api-key</span>，其余走 <span className="text-zinc-400">Bearer</span>。</div>}
              </div>

              {formError && (
                <div className="rounded-lg border px-3 py-2 mono text-[11px] text-red-300" style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.2)" }}>{formError}</div>
              )}
            </div>
          </div>

          <div className="px-4 py-4 mono text-[11px] leading-relaxed text-zinc-600">
            保存后 Shell Service 会重写 models.json（校验通过才落盘）并以 pi 原生格式写入 auth.json，随后重启该项目的 pi 进程，使新目录立刻可用。
          </div>
        </div>

        <div className="p-3 border-t flex items-center gap-2 shrink-0" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
          <button onClick={onClose} className="px-3 py-2 rounded-lg border mono text-[13px] text-zinc-400 hover:text-zinc-200" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>取消</button>
          <span className="mono text-[11px] text-zinc-600 hidden sm:inline">保存后自动选中新模型</span>
          <button onClick={handleSave} className="ml-auto px-4 py-2 rounded-lg text-[13px] font-medium" style={{ background: "#ededed", color: "#0a0a0a" }}>写入 pi 配置</button>
        </div>
      </div>
    </div>
  )
}
