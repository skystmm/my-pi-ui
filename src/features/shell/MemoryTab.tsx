import { useEffect, useRef, useState } from "react"
import { wsClient } from "../../lib/ws-client"
import { useMemoryUsed, useMemorySuggestions } from "../../stores/appStore"
import type { MemoryRecord, MemoryScopeKind, MemorySuggestionRecord } from "../../lib/ws-protocol"

const scopeNames: Record<MemoryScopeKind, string> = { app: "应用", project: "项目", session: "会话" }

export function MemoryTab({ cwd, sessionId }: { cwd: string; sessionId: string }) {
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const used = useMemoryUsed(sessionId)
  const [scope, setScope] = useState<MemoryScopeKind>("project")
  const [content, setContent] = useState("")
  const [editing, setEditing] = useState<MemoryRecord | null>(null)
  const [reviewing, setReviewing] = useState<MemorySuggestionRecord | null>(null)
  const suggestions = useMemorySuggestions(cwd)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const pendingRequestId = useRef<string | null>(null)
  const [settings, setSettings] = useState({ recallEnabled: true, suggestEnabled: true })

  useEffect(() => {
    setMemories([])
    setEditing(null)
    setReviewing(null)
    setContent("")
    pendingRequestId.current = null
    setBusy(false)
    wsClient.send({ t: "memory_list", cwd, sessionId })
    if (cwd) wsClient.send({ t: "memory_list_suggestions", cwd })
    wsClient.send({ t: "get_memory_settings" })
    const off = wsClient.on(ev => {
      if (ev.t === "memory_snapshot" && ev.cwd === cwd && ev.sessionId === sessionId) setMemories(ev.memories)
      if (ev.t === "memory_result" && ev.requestId === pendingRequestId.current) {
        pendingRequestId.current = null
        setBusy(false)
        setMessage(ev.message)
        if (ev.ok) { setEditing(null); setReviewing(null); setContent("") }
      }
      if (ev.t === "memory_settings") setSettings(ev)
    })
    return off
  }, [cwd, sessionId])

  function save() {
    if (!content.trim() || busy) return
    const requestId = crypto.randomUUID()
    pendingRequestId.current = requestId
    setBusy(true)
    setMessage("")
    if (reviewing) wsClient.send({ t: "memory_resolve_suggestion", requestId, cwd, sessionId, id: reviewing.id, action: "accept", scope, content })
    else if (editing) wsClient.send({ t: "memory_update", requestId, scope: editing.scope.kind, cwd, sessionId, id: editing.id, expectedRevision: editing.revision, content })
    else wsClient.send({ t: "memory_create", requestId, scope, cwd, sessionId, content })
  }

  function ignore(suggestion: MemorySuggestionRecord) {
    if (busy) return
    const requestId = crypto.randomUUID()
    pendingRequestId.current = requestId
    setBusy(true)
    wsClient.send({ t: "memory_resolve_suggestion", requestId, cwd, id: suggestion.id, action: "reject" })
  }

  function forget(memory: MemoryRecord) {
    if (busy || !window.confirm(`删除这条${scopeNames[memory.scope.kind]}记忆？\n\n${memory.content}`)) return
    const requestId = crypto.randomUUID()
    pendingRequestId.current = requestId
    setBusy(true)
    wsClient.send({ t: "memory_delete", requestId, scope: memory.scope.kind, cwd, sessionId, id: memory.id, expectedRevision: memory.revision })
  }

  const field = "w-full rounded-md border px-2.5 py-2 text-[12px] bg-[var(--bg)] focus:outline-none focus:border-zinc-500"
  const button = "rounded-md border px-2.5 py-1.5 mono text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-40"
  return <div className="space-y-3">
    <section className="rounded-lg border p-3 space-y-2" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <div className="mono text-[11px] text-zinc-500">记忆行为 · 全局设置</div>
      <label className="flex items-center gap-2 text-[12px] text-zinc-300"><input type="checkbox" checked={settings.recallEnabled} onChange={e => {
        const recallEnabled = e.target.checked
        setSettings(previous => ({ ...previous, recallEnabled }))
        wsClient.send({ t: "set_memory_settings", recallEnabled })
      }} /> 自动调用已确认的记忆</label>
      <label className="flex items-center gap-2 text-[12px] text-zinc-300"><input type="checkbox" checked={settings.suggestEnabled} onChange={e => {
        const suggestEnabled = e.target.checked
        setSettings(previous => ({ ...previous, suggestEnabled }))
        wsClient.send({ t: "set_memory_settings", suggestEnabled })
      }} /> 从对话提出待确认建议</label>
    </section>
    <section className="rounded-lg border p-3" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <div className="mono text-[11px] text-zinc-500 mb-2">本轮使用 · {used.length} 条</div>
      {used.length ? <div className="space-y-2">{used.map(m => <div key={m.id} className="border-l-2 border-violet-500 pl-2 text-[12px] text-zinc-300 whitespace-pre-wrap">
        <span className="mono text-[10px] text-zinc-500">{scopeNames[m.scope.kind]} · {m.id.slice(0, 8)}</span><div>{m.content}</div>
      </div>)}</div> : <p className="text-[11px] text-zinc-600">本轮尚未调用记忆。已保存的记忆只在适用范围内进入模型 context。</p>}
    </section>

    {suggestions.length > 0 && <section className="rounded-lg border p-3 space-y-2" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <div className="mono text-[11px] text-zinc-500">待确认偏好 · {suggestions.length}</div>
      {suggestions.map(s => <div key={s.id} className="border-b pb-2 last:border-0 text-[12px]" style={{ borderColor: "var(--border)" }}>
        <div className="text-zinc-300">{s.content}</div>
        <div className="text-[10px] text-zinc-500">建议{scopeNames[s.scope.kind]}级 · {s.evidence.length} 处对话证据</div>
        <details className="text-[10px] text-zinc-500 mt-1"><summary className="cursor-pointer">查看证据来源</summary><div className="space-y-1 mt-1">{s.evidence.map((e, i) => <div key={`${e.projectPath}:${e.sessionId}:${i}`} className="break-all">{e.projectPath} · session {e.sessionId.slice(0, 8)}</div>)}</div></details>
        <div className="flex gap-3 mt-1"><button className="text-sky-400" onClick={() => { setReviewing(s); setEditing(null); setScope(s.scope.kind); setContent(s.content) }}>审阅并保存</button><button className="text-zinc-500" onClick={() => ignore(s)}>忽略</button></div>
      </div>)}
    </section>}

    <section className="rounded-lg border p-3 space-y-2" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <div className="mono text-[11px] text-zinc-500">{reviewing ? "审阅偏好建议" : editing ? "编辑记忆" : "显式记录 · 审阅后保存"}</div>
      {!editing && <select value={scope} onChange={e => setScope(e.target.value as MemoryScopeKind)} className={field} aria-label="记忆作用域">
        <option value="project">当前项目</option><option value="session" disabled={!sessionId}>当前会话</option><option value="app">全部项目（应用级）</option>
      </select>}
      {editing && <div className="mono text-[11px] text-zinc-500">{scopeNames[editing.scope.kind]} · 修订 {editing.revision}</div>}
      <textarea value={content} onChange={e => setContent(e.target.value)} rows={4} placeholder="写下希望长期记住的事实或偏好" className={`${field} resize-y`} />
      <div className="flex gap-2">
        <button onClick={save} disabled={(!cwd && scope !== "app") || !content.trim() || busy || (scope === "session" && !sessionId)} className={button} style={{ borderColor: "var(--border)" }}>保存</button>
        {(editing || reviewing) && <button onClick={() => { setEditing(null); setReviewing(null); setContent("") }} className={button} style={{ borderColor: "var(--border)" }}>取消</button>}
      </div>
      {message && <div role="status" className="text-[11px] text-zinc-400">{message}</div>}
    </section>

    <section className="rounded-lg border p-3" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <div className="mono text-[11px] text-zinc-500 mb-2">已保存 · {memories.length} 条</div>
      {memories.length ? <div className="space-y-2 max-h-[390px] overflow-auto">{memories.map(m => <div key={m.id} className="border-b pb-2 last:border-0" style={{ borderColor: "var(--border)" }}>
        <div className="mono text-[10px] text-zinc-500">{scopeNames[m.scope.kind]} · {m.id.slice(0, 8)} · rev {m.revision}</div>
        <p className="text-[12px] text-zinc-300 whitespace-pre-wrap my-1">{m.content}</p>
        <div className="flex gap-3"><button onClick={() => { setEditing(m); setReviewing(null); setContent(m.content) }} className="text-[11px] text-sky-400">编辑</button><button onClick={() => forget(m)} className="text-[11px] text-rose-400">删除</button></div>
      </div>)}</div> : <div className="text-[11px] text-zinc-600">暂无记忆</div>}
    </section>
  </div>
}
