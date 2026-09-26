import { useEffect, useMemo, useRef, useState } from "react"
import type { ModelEntry, ProviderAccount } from "../../lib/ws-protocol"

const statusLabel: Record<ProviderAccount["status"], { dot: string; label: string }> = {
  connected: { dot: "bg-emerald-500", label: "已连接" },
  missing_key: { dot: "bg-amber-500", label: "未配置凭据" },
  error: { dot: "bg-red-500", label: "异常" },
}

type Props = {
  providers: ProviderAccount[]
  models: ModelEntry[]
  /** "<provider>/<modelId>" pi is actually on */
  activeModelKey: string
  onSelectModel: (model: ModelEntry) => void
  onOpenDrawer: () => void
  openRequest: number
}

export function ModelMenu({ providers, models, activeModelKey, onSelectModel, onOpenDrawer, openRequest }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const activeModel = useMemo(
    () => models.find(m => `${m.providerId}/${m.id}` === activeModelKey),
    [models, activeModelKey],
  )
  const activeProvider = useMemo(
    () => providers.find(p => p.id === activeModel?.providerId) ?? providers.find(p => p.status === "connected") ?? providers[0],
    [providers, activeModel],
  )
  const grouped = useMemo(() => providers.map(p => ({ provider: p, models: models.filter(m => m.providerId === p.id) })), [providers, models])

  useEffect(() => { if (openRequest) setOpen(true) }, [openRequest])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey) }
  }, [])

  const label = activeModelKey || (models.length ? "未选择模型" : "未配置模型")

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] border hover:bg-[var(--bg-hover)]"
        style={{ background: "var(--bg-card)", borderColor: open ? "var(--border-strong)" : "var(--border)", color: "var(--fg)" }}
        title={activeModel ? `pi 当前模型 · ${activeModelKey}` : "pi 当前没有可用模型"}
      >
        <span className={`w-2 h-2 rounded-full ${activeProvider?.status === "connected" ? "bg-emerald-500" : "bg-amber-500"}`} />
        <span className="max-w-[220px] truncate">{label}</span>
        <span className="text-zinc-500">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-[380px] rounded-xl border shadow-xl overflow-hidden z-40" style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>
          <div className="px-3 pt-3 pb-2 flex items-center justify-between">
            <span className="mono text-[11px] font-medium tracking-wide text-zinc-500">MODEL · {providers.length} providers · {models.length} models</span>
            <button onClick={() => { setOpen(false); onOpenDrawer() }} className="mono text-[11px] px-2 py-1 rounded-md border hover:bg-[var(--bg-hover)] text-zinc-300" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>管理 →</button>
          </div>
          <div className="max-h-[360px] overflow-auto px-2 pb-2 space-y-3">
            {grouped.length === 0 && (
              <div className="mono text-[11px] text-zinc-600 px-2 py-3 rounded border border-dashed text-center" style={{ borderColor: "var(--border)" }}>
                暂无服务商 · 点下方「添加服务商 / 模型」写入 ~/.pi/agent/models.json
              </div>
            )}
            {grouped.map(({ provider, models: ms }) => (
              <div key={provider.id}>
                <div className="flex items-center gap-2 px-2 py-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${statusLabel[provider.status].dot}`} />
                  <span className="text-[12px] font-medium">{provider.name}</span>
                  <span className="mono text-[10px] px-1 py-0.5 rounded border text-zinc-500" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>{provider.id}</span>
                  <span className="mono text-[10px] text-zinc-500 ml-auto">{statusLabel[provider.status].label}</span>
                </div>
                {provider.baseUrl && <div className="mono text-[11px] text-zinc-600 px-2 truncate">{provider.baseUrl}</div>}
                <div className="mt-1 space-y-1">
                  {ms.length === 0 ? (
                    <div className="mono text-[11px] text-zinc-600 px-2 py-1.5 rounded border border-dashed" style={{ borderColor: "var(--border)" }}>
                      pi 内置目录提供模型 · 打开一次项目后从 pi 拉取
                    </div>
                  ) : ms.map(m => {
                    const key = `${m.providerId}/${m.id}`
                    const isActive = key === activeModelKey
                    const usable = m.available !== false
                    return (
                      <button
                        key={key}
                        onClick={() => { onSelectModel(m); setOpen(false) }}
                        className={`w-full text-left px-2.5 py-2 rounded-lg border flex items-center gap-2 ${isActive ? "bg-[var(--bg-muted)] border-[var(--border-strong)]" : "border-transparent hover:bg-[var(--bg-muted)] hover:border-[var(--border)]"} ${usable ? "" : "opacity-60"}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-emerald-500" : usable ? "bg-zinc-600" : "bg-amber-600"}`} />
                        <span className="flex-1 min-w-0">
                          <div className="text-[12.5px] leading-none truncate">{m.displayName} <span className="mono text-[11px] text-zinc-500">· {m.id}</span></div>
                          <div className="mono text-[10px] text-zinc-500 mt-1 flex gap-1 flex-wrap items-center">
                            <span className="px-1 py-0.5 rounded" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>{m.compat[0]}</span>
                            {m.contextWindow ? <span>{Math.round(m.contextWindow / 1024)}k ctx</span> : null}
                            <span>· {m.thinkingDefault}</span>
                          </div>
                        </span>
                        {isActive && <span className="mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">active</span>}
                        {!isActive && !usable && <span className="mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">未就绪</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="p-2 border-t flex gap-2" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
            <button onClick={() => { setOpen(false); onOpenDrawer() }} className="flex-1 py-2 rounded-lg text-[13px] font-medium border hover:bg-[var(--bg-hover)]" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>＋ 添加服务商 / 模型</button>
            <button onClick={() => setOpen(false)} className="px-3 py-2 rounded-lg mono text-[12px] border text-zinc-400" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>关闭</button>
          </div>
          <div className="px-3 py-2 mono text-[10px] leading-relaxed text-zinc-600" style={{ background: "var(--bg)" }}>
            切换即调用 pi rpc set_model，并写入 settings.json 的 defaultProvider / defaultModel（下次启动 pi 生效）
          </div>
        </div>
      )}
    </div>
  )
}
