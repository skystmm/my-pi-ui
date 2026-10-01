import { useEffect, useState } from "react"
import { wsClient } from "../../lib/ws-client"
import { usePendingExtensionUI, clearPendingExtensionUI } from "../../stores/appStore"

export function ExtensionUIOverlay() {
  const pending = usePendingExtensionUI()
  const [value, setValue] = useState("")
  const [countdown, setCountdown] = useState<number | null>(null)

  useEffect(() => { setValue(pending?.kind === "editor" ? String((pending.data as { prefill?: unknown })?.prefill ?? "") : ""); setCountdown(null) }, [pending?.requestId])

  useEffect(() => {
    if (!pending) return
    const data = pending.data as Record<string, unknown>
    const timeout = typeof data?.["timeout"] === "number" ? (data["timeout"] as number) : null
    if (timeout == null) return
    const start = Date.now()
    setCountdown(Math.ceil(timeout / 1000))
    const t = setInterval(() => {
      const remain = timeout - (Date.now() - start)
      if (remain <= 0) { clearInterval(t); sendCancel() }
      else setCountdown(Math.ceil(remain / 1000))
    }, 250)
    return () => clearInterval(t)
  }, [pending?.requestId])

  if (!pending) return null

  const data = pending.data as Record<string, unknown>
  const title = String(data?.["title"] ?? pending.kind)
  const message = String(data?.["message"] ?? "")
  const options = Array.isArray(data?.["options"]) ? (data["options"] as string[]) : []
  const placeholder = String(data?.["placeholder"] ?? "")

  function sendCancel() {
    wsClient.send({ t: "extension_ui_response", requestId: pending!.requestId, cancelled: true, cwd: pending!.cwd } as never)
    clearPendingExtensionUI()
  }
  function sendValue(v: unknown) {
    wsClient.send({ t: "extension_ui_response", requestId: pending!.requestId, result: v, cwd: pending!.cwd } as never)
    clearPendingExtensionUI()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-[1px]" onClick={sendCancel}>
      <div className="w-[480px] max-w-[92vw] rounded-xl border shadow-2xl flex flex-col overflow-hidden" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }} onClick={e=>e.stopPropagation()}>
        <div className="h-[44px] flex items-center justify-between px-4 border-b" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
          <div className="text-[13px] font-medium truncate">{title}</div>
          <button onClick={sendCancel} className="w-7 h-7 grid place-items-center rounded-md border text-[12px]" style={{ borderColor: "var(--border)" }}>✕</button>
        </div>
        {countdown !== null && (
          <div className="h-1 bg-[var(--bg-muted)]"><div className="h-1 bg-emerald-500 transition-all" style={{ width: `${Math.max(0, countdown * 10)}%` }} /></div>
        )}
        <div className="p-4 space-y-3">
          {pending.kind === "select" && (
            <div className="space-y-2 max-h-[320px] overflow-auto">
              {options.map(o=>(
                <button key={o} onClick={()=>sendValue(o)} className="w-full text-left px-3 py-2 rounded-lg border text-[13px] hover:opacity-90" style={{ background:"var(--bg)", borderColor:"var(--border)" }}>{o}</button>
              ))}
              {options.length===0 && <div className="text-[12px] opacity-60">无选项</div>}
            </div>
          )}
          {pending.kind === "confirm" && (
            <>
              {message && <div className="text-[13px] opacity-80 whitespace-pre-wrap">{message}</div>}
              <div className="flex gap-2 justify-end">
                <button onClick={sendCancel} className="px-4 py-1.5 rounded-lg border text-[13px]" style={{ borderColor:"var(--border)", background:"var(--bg)" }}>取消</button>
                <button onClick={()=>sendValue(true)} className="px-4 py-1.5 rounded-lg text-[13px] font-medium" style={{ background:"#ededed", color:"#0a0a0a" }}>确认</button>
              </div>
            </>
          )}
          {pending.kind === "input" && (
            <div className="space-y-3">
              <input value={value} onChange={e=>setValue(e.target.value)} placeholder={placeholder} autoFocus onKeyDown={e=>{ if(e.key==="Enter") sendValue(value); if(e.key==="Escape") sendCancel() }} className="w-full px-3 py-2 rounded-lg border bg-[var(--bg)] text-[13px] focus:outline-none" style={{ borderColor:"var(--border)" }} />
              <div className="flex gap-2 justify-end">
                <button onClick={sendCancel} className="px-4 py-1.5 rounded-lg border text-[13px]" style={{ borderColor:"var(--border)", background:"var(--bg)" }}>取消</button>
                <button onClick={()=>sendValue(value)} className="px-4 py-1.5 rounded-lg text-[13px] font-medium" style={{ background:"#ededed", color:"#0a0a0a" }}>提交</button>
              </div>
            </div>
          )}
          {pending.kind === "editor" && (
            <div className="space-y-3">
              <textarea value={value} onChange={e=>setValue(e.target.value)} rows={8} autoFocus className="w-full px-3 py-2 rounded-lg border bg-[var(--bg)] text-[13px] font-mono focus:outline-none resize-none" style={{ borderColor:"var(--border)" }} />
              <div className="flex gap-2 justify-end">
                <button onClick={sendCancel} className="px-4 py-1.5 rounded-lg border text-[13px]" style={{ borderColor:"var(--border)", background:"var(--bg)" }}>取消</button>
                <button onClick={()=>sendValue(value)} className="px-4 py-1.5 rounded-lg text-[13px] font-medium" style={{ background:"#ededed", color:"#0a0a0a" }}>保存</button>
              </div>
            </div>
          )}
          {countdown !== null && <div className="text-[11px] mono opacity-60 text-center">{countdown}s 后自动取消</div>}
        </div>
      </div>
    </div>
  )
}
