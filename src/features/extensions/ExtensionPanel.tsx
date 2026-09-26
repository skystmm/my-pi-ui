import { useEffect, useState } from "react"
import { wsClient } from "../../lib/ws-client"
import type { ExtensionEntry, SkillEntry } from "../../lib/ws-protocol"

type Props = {
  open: boolean
  onClose: () => void
  extensions: ExtensionEntry[]
  skills: SkillEntry[]
  scope: "global" | "project"
  onScopeChange: (s: "global" | "project") => void
  projectCwd?: string
  projectTrusted?: boolean
  onTrustProject?: () => void
}

/** pi loads resources from these settings keys — validated before writing. */
function validateSource(source: string): string | null {
  const s = source.trim()
  if (!s) return "请填写 npm 包名或本地路径"
  if (s.startsWith(".") || s.startsWith("/") || s.startsWith("~")) return null
  if (/^[a-z0-9@._/-]+$/.test(s)) return null
  try { new URL(s); return null } catch { return "既不是本地路径也不是包名" }
}

export function ExtensionPanel({ open, onClose, extensions, skills, scope, onScopeChange, projectCwd, projectTrusted, onTrustProject }: Props) {
  const [tab, setTab] = useState<"ext" | "skill">("ext")
  const [source, setSource] = useState("")
  const [name, setName] = useState("")
  const [err, setErr] = useState<string | null>(null)

  // refresh from the source of truth whenever the drawer opens or the scope changes
  useEffect(() => {
    if (!open) return
    wsClient.send({ t: "list_extensions", scope, cwd: projectCwd })
    wsClient.send({ t: "list_skills", scope, cwd: projectCwd })
  }, [open, scope, projectCwd])

  if (!open) return null

  const projectBlocked = scope === "project" && (!projectCwd || !projectTrusted)
  const shown = extensions.filter(e => e.scope === scope || e.scope === "global")

  function handleAdd() {
    const v = validateSource(source)
    if (v) { setErr(v); return }
    if (projectBlocked) { setErr(projectCwd ? "项目未信任：先点上方「信任项目」再写 .pi/settings.json" : "未选择项目"); return }
    setErr(null)
    wsClient.send({ t: "install_extension", source: source.trim(), scope, cwd: projectCwd, name: name.trim() || undefined })
    setSource(""); setName("")
  }

  function handleRemove(e: ExtensionEntry) {
    if (!confirm(`从 pi 配置中移除 ${e.name}？\n${e.source === "npm" ? "packages" : "extensions"} 中删除：${e.path}`)) return
    wsClient.send({ t: "remove_extension", source: e.path, scope: e.scope, cwd: projectCwd })
  }

  function handleToggle(e: ExtensionEntry) {
    // pi's toggle is presence in the settings array
    wsClient.send({ t: "set_extension_enabled", source: e.path, enabled: !e.enabled, scope: e.scope, cwd: projectCwd })
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div data-drawer-close onClick={onClose} className="flex-1 bg-black/50 backdrop-blur-[1px]" />
      <div className="w-[560px] max-w-[92vw] h-full border-l flex flex-col shadow-2xl" style={{ background: "var(--bg)", borderColor: "var(--border)", boxShadow: "-16px 0 48px rgba(0,0,0,0.6)" }}>
        <div className="h-[48px] flex items-center gap-3 px-4 border-b shrink-0" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
          <div className="text-[13px] font-medium">扩展与技能</div>
          <span className="text-[11px] px-1.5 py-0.5 rounded border mono" style={{ borderColor: "var(--border)", background: "var(--bg-muted)" }}>{extensions.length} 扩展 · {skills.length} 技能</span>
          <div className="flex-1" />
          <button onClick={onClose} className="w-7 h-7 grid place-items-center rounded-md border text-[12px]" style={{ borderColor: "var(--border)" }}>✕</button>
        </div>

        <div className="px-4 pt-3">
          <div className="flex gap-1 p-1 rounded-lg border w-fit" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
            {[
              { k: "global", label: "全局 · ~/.pi/agent/settings.json" },
              { k: "project", label: projectCwd ? `项目 · ${projectCwd}/.pi/settings.json` : "项目 · 未选择" },
            ].map(o => (
              <button key={o.k} onClick={() => onScopeChange(o.k as "global" | "project")} className={`px-2.5 py-1 rounded-md text-[11px] mono border ${scope === o.k ? "bg-[var(--bg-muted)] text-zinc-100" : "border-transparent text-zinc-400"}`} style={scope === o.k ? { borderColor: "var(--border-strong)" } : {}}>{o.label}</button>
            ))}
          </div>
          {scope === "project" && !projectCwd && <div className="mt-2 text-[11px] px-2 py-1.5 rounded border bg-amber-500/10 border-amber-500/20 text-amber-300">未选择项目：先打开一个项目目录</div>}
          {scope === "project" && projectCwd && !projectTrusted && (
            <div className="mt-2 text-[11px] px-2 py-1.5 rounded border bg-amber-500/10 border-amber-500/20 text-amber-300 flex items-center gap-2">
              <span>项目未信任 · pi 不会加载 .pi 下的资源（写入也会被拒绝）</span>
              <button onClick={onTrustProject} className="ml-auto px-2 py-0.5 rounded border border-amber-500/30 hover:bg-amber-500/10">信任项目</button>
            </div>
          )}
        </div>

        <div className="px-4 pt-3 flex gap-2 border-b pb-2 shrink-0" style={{ borderColor: "var(--border)" }}>
          <button onClick={() => setTab("ext")} className={`flex-1 py-1.5 rounded-md border mono text-[11px] ${tab === "ext" ? "text-zinc-200" : "border-transparent text-zinc-500"}`} style={tab === "ext" ? { background: "var(--bg-muted)", borderColor: "var(--border-strong)" } : {}}>扩展</button>
          <button onClick={() => setTab("skill")} className={`flex-1 py-1.5 rounded-md border mono text-[11px] ${tab === "skill" ? "text-zinc-200" : "border-transparent text-zinc-500"}`} style={tab === "skill" ? { background: "var(--bg-muted)", borderColor: "var(--border-strong)" } : {}}>技能</button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
          {tab === "ext" ? (
            <>
              <div className="space-y-2">
                {shown.length === 0 && <div className="rounded-lg border border-dashed p-3 text-[12px] opacity-60 text-center" style={{ borderColor: "var(--border)" }}>pi 配置里还没有扩展 · 在下方添加本地路径或 npm 包</div>}
                {shown.map(e => (
                  <div key={e.id} className="rounded-lg border p-3 flex items-start justify-between gap-3" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${e.enabled ? "bg-emerald-500" : "bg-zinc-600"}`} />
                        <span className="text-[13px] font-medium truncate">{e.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border mono" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>{e.source === "npm" ? "packages" : "extensions"}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border mono" style={{ borderColor: "var(--border)", background: e.scope === "global" ? "var(--bg-muted)" : "var(--bg)" }}>{e.scope}</span>
                      </div>
                      <div className="text-[11px] mono opacity-50 truncate mt-0.5">{e.path}</div>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button onClick={() => handleToggle(e)} className="text-[11px] px-2 py-1 rounded border mono" style={{ background: e.enabled ? "var(--bg)" : "#ededed", color: e.enabled ? "var(--fg)" : "#0a0a0a", borderColor: "var(--border)" }}>{e.enabled ? "禁用" : "启用"}</button>
                      <button onClick={() => handleRemove(e)} className="text-[11px] px-2 py-1 rounded border mono" style={{ borderColor: "var(--border)" }}>移除</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border p-4 space-y-3" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
                <div className="text-[12px] font-medium">添加扩展</div>
                <div className="grid grid-cols-1 gap-2">
                  <input value={source} onChange={e => { setSource(e.target.value); setErr(null) }} placeholder="本地路径（如 ~/.pi/ext/x.ts 或 ./my-ext）或 npm 包名（@scope/ext）" className="px-2.5 py-2 rounded-lg border bg-[var(--bg)] mono text-[13px] focus:outline-none focus:border-zinc-600" style={{ borderColor: "var(--border)" }} />
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="显示名（可选，仅影响列表展示）" className="px-2.5 py-2 rounded-lg border bg-[var(--bg)] mono text-[13px] focus:outline-none focus:border-zinc-600" style={{ borderColor: "var(--border)" }} />
                </div>
                {err && <div className="text-[11px] px-2 py-1 rounded border bg-red-500/10 border-red-500/20 text-red-300 mono">{err}</div>}
                <div className="flex gap-2">
                  <button onClick={handleAdd} disabled={projectBlocked} className="flex-1 py-1.5 rounded-lg text-[13px] font-medium disabled:opacity-40" style={{ background: "#ededed", color: "#0a0a0a" }}>写入 {scope === "global" ? "全局" : "项目"} 配置</button>
                  <button onClick={onClose} className="px-4 py-1.5 rounded-lg border text-[13px]" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>取消</button>
                </div>
                <div className="text-[11px] mono opacity-60 leading-relaxed">
                  本地路径写入 <span className="opacity-100">settings.extensions</span>，npm 包写入 <span className="opacity-100">settings.packages</span> — 这正是 pi 的加载方式（禁用 = 从数组移除）。项目级写入经 proper-lockfile + 0600，且需要项目已信任。
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {skills.length === 0 && <div className="rounded-lg border border-dashed p-3 text-[12px] opacity-60 text-center" style={{ borderColor: "var(--border)" }}>pi 未报告任何技能 · 可在项目里打开一次会话后重试</div>}
              {skills.map(s => (
                <div key={s.id} className="rounded-lg border p-3 flex items-start justify-between gap-3" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${s.enabled ? "bg-sky-500" : "bg-zinc-600"}`} />
                      <span className="text-[13px] font-medium truncate">{s.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded border mono" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>{s.source === "rpc" ? "pi 命令" : s.source === "package" ? "packages" : "skills"}</span>
                    </div>
                    {s.description && <div className="text-[11px] opacity-60 truncate mt-0.5">{s.description}</div>}
                    {s.path && <div className="text-[11px] mono opacity-50 truncate mt-0.5">{s.path}{s.scope ? ` · ${s.scope}` : ""}</div>}
                  </div>
                  <button onClick={() => wsClient.send({ t: "invoke_skill", skillId: s.name, cwd: projectCwd ?? "" })} disabled={!projectCwd} className="text-[11px] px-2 py-1 rounded border mono shrink-0 disabled:opacity-40" style={{ borderColor: "var(--border)" }}>调用</button>
                </div>
              ))}
              <div className="text-[11px] mono opacity-60 leading-relaxed">
                技能来源：pi 的 <span className="opacity-100">get_commands</span>（slash 命令）+ settings.skills 路径 + packages。调用即发送 <span className="opacity-100">/skill:&lt;name&gt;</span>。
              </div>
            </div>
          )}
        </div>

        <div className="p-3 border-t flex justify-between items-center" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
          <span className="text-[11px] mono opacity-60">Esc 关闭 · 写入后 pi 下次启动加载</span>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border text-[12px]" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>关闭</button>
        </div>
      </div>
    </div>
  )
}
