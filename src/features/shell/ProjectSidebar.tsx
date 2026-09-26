import type { ProjectMeta, SessionMeta } from "../../lib/ws-protocol"

type Props = {
  projects: ProjectMeta[]
  archivedProjects: ProjectMeta[]
  projectId: string
  curProject: ProjectMeta | null
  curSessions: SessionMeta[]
  archivedSessions: SessionMeta[]
  sessionId: string
  curSession: SessionMeta | null
  activeModelKey: string
  providerCount: number
  modelCount: number
  extensionCount: number
  skillCount: number
  lastErrorCode?: string
  pickingDir: boolean
  onPickDir: () => void
  onSelectProject: (p: ProjectMeta) => void
  onArchiveProject: (p: ProjectMeta, archived: boolean) => void
  onSelectSession: (id: string) => void
  onArchiveSession: (id: string, archived: boolean) => void
  onNewSession: () => void
  onOpenModelDrawer: () => void
  onOpenExtensionDrawer: () => void
  onTrustProject: (trusted: boolean) => void
}

export function ProjectSidebar(props: Props) {
  const {
    projects, archivedProjects, projectId, curProject, curSessions, archivedSessions, sessionId, curSession, activeModelKey,
    providerCount, modelCount, extensionCount, skillCount, lastErrorCode,
    pickingDir, onPickDir,
    onSelectProject, onArchiveProject, onSelectSession, onArchiveSession, onNewSession, onOpenModelDrawer, onOpenExtensionDrawer, onTrustProject,
  } = props

  return (
    <aside className="w-[280px] shrink-0 border-r flex flex-col overflow-hidden" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
      <div className="px-3 pt-3 pb-2">
        <div className="text-[11px] font-medium tracking-wide text-zinc-500 mb-2">PROJECTS</div>
        <div className="space-y-1">
          {projects.length === 0 ? (
            <div className="mono text-[11px] text-zinc-600 px-2 py-3 border border-dashed rounded" style={{ borderColor: "var(--border)" }}>{archivedProjects.length ? "所有项目均已归档，可从下方恢复" : <>暂无项目 · 在终端 <span className="text-zinc-400">pi</span> 启动一次会话，或点击下方打开目录</>}</div>
          ) : projects.map(p => (
            <div key={p.id} className="flex items-center gap-1 group">
            <button
              onClick={() => onSelectProject(p)}
              className={`w-full text-left px-2.5 py-2 rounded-md flex items-center gap-2 border ${projectId === p.id || (!projectId && p.id === projects[0].id) ? "bg-[var(--bg-card)] border-[var(--border-strong)]" : "border-transparent hover:bg-[var(--bg-card)] hover:border-[var(--border)]"}`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${p.trust === "trusted" ? "bg-zinc-400" : p.trust === "untrusted" ? "bg-amber-500" : "bg-zinc-600"}`} />
              <span className="flex-1 min-w-0">
                <div className="text-[13px] leading-none truncate">{p.displayName}</div>
                <div className="mono text-[11px] text-zinc-500 truncate">{p.cwd}</div>
              </span>
              <span className="mono text-[11px] text-zinc-500">{p.sessionCount}</span>
            </button>
            <button aria-label={`归档项目 ${p.displayName}`} title="归档项目" onClick={() => onArchiveProject(p, true)} className="px-1.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-200">归档</button>
            </div>
          ))}
        </div>
        {archivedProjects.length > 0 && <details className="mt-2 text-[11px] text-zinc-500">
          <summary className="cursor-pointer">已归档项目 · {archivedProjects.length}</summary>
          <div className="space-y-1 mt-1">{archivedProjects.map(p => <div key={p.id} className="flex items-center gap-1 rounded border px-2 py-1.5" style={{ borderColor: "var(--border)" }}><span className="flex-1 truncate" title={p.cwd}>{p.displayName}</span><button aria-label={`恢复项目 ${p.displayName}`} onClick={() => onArchiveProject(p, false)} className="text-zinc-300 hover:text-white">恢复</button></div>)}</div>
        </details>}
        <button onClick={onPickDir} disabled={pickingDir} className="mt-2 w-full py-1.5 rounded-md border border-dashed text-[12px] text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-50" style={{ borderColor: "var(--border)" }}>
          {pickingDir ? "正在选择目录…" : "+ 打开项目目录"}
        </button>
        {curProject && curProject.trust !== "trusted" && (
          <div className="mt-2 rounded-md border px-2 py-1.5 text-[11px] flex items-center gap-2" style={{ borderColor: "rgba(245,158,11,0.25)", background: "rgba(245,158,11,0.08)", color: "#fcd34d" }}>
            <span className="mono truncate">{curProject.trust === "untrusted" ? "项目标记为不信任" : "项目信任状态未知"}</span>
            <button onClick={() => onTrustProject(true)} className="ml-auto px-1.5 py-0.5 rounded border border-amber-500/30 hover:bg-amber-500/10 shrink-0">信任</button>
            {curProject.trust === "unknown" && (
              <button onClick={() => onTrustProject(false)} className="px-1.5 py-0.5 rounded border border-amber-500/30 hover:bg-amber-500/10 shrink-0" title="写入 trust.json 并拒绝加载 .pi 资源">拒绝</button>
            )}
          </div>
        )}
      </div>

      <div className="mx-3 h-px my-2" style={{ background: "var(--border)" }} />

      <div className="flex-1 overflow-auto px-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-medium tracking-wide text-zinc-500">SESSIONS · {curProject?.displayName ?? "—"}</div>
          <span className="mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-muted)", color: "var(--fg-muted)" }}>{curSessions.length}</span>
        </div>
        <div className="space-y-1">
          {curSessions.length === 0 ? (
            <div className="mono text-[11px] text-zinc-600 px-2 py-2 border border-dashed rounded" style={{ borderColor: "var(--border)" }}>{curProject ? (archivedSessions.length ? "所有会话均已归档，可从下方恢复" : "暂无会话") : "未选择项目"}</div>
          ) : curSessions.map(s => (
            <div key={s.id} className="flex items-start gap-1">
            <button
              onClick={() => onSelectSession(s.id)}
              className={`flex-1 min-w-0 text-left px-2.5 py-2 rounded-md border ${sessionId === s.id ? "bg-[var(--bg-muted)] border-[var(--border-strong)]" : "border-transparent hover:bg-[var(--bg-card)]"}`}
            >
              <div className="text-[13px] leading-tight line-clamp-2">{s.title}</div>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className="mono text-[10px] px-1 py-0.5 rounded" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", color: "var(--fg-muted)" }}>{s.id === curSession?.id && activeModelKey ? activeModelKey : (s.model || "—")}</span>
                <span className="mono text-[10px] text-zinc-500">{s.thinking}</span>
                <span className="mono text-[10px] text-zinc-600">{s.mtime ? new Date(s.mtime).toLocaleString() : ""}</span>
              </div>
              {(s.hasBranch || s.hasCompaction) && (
                <div className="flex gap-1 mt-1.5">
                  {s.hasBranch && <span className="text-[10px] px-1 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/20">branch</span>}
                  {s.hasCompaction && <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">compaction</span>}
                </div>
              )}
            </button>
            <button aria-label={`归档会话 ${s.title}`} title="归档会话" onClick={() => onArchiveSession(s.id, true)} className="px-1 py-2 text-[11px] text-zinc-500 hover:text-zinc-200">归档</button>
            </div>
          ))}
        </div>
        {archivedSessions.length > 0 && <details className="mt-3 text-[11px] text-zinc-500">
          <summary className="cursor-pointer">已归档会话 · {archivedSessions.length}</summary>
          <div className="space-y-1 mt-1">{archivedSessions.map(s => <div key={s.id} className="flex items-center gap-1 rounded border px-2 py-1.5" style={{ borderColor: "var(--border)" }}><span className="flex-1 min-w-0 truncate" title={s.title}>{s.title}</span><button aria-label={`恢复会话 ${s.title}`} onClick={() => onArchiveSession(s.id, false)} className="text-zinc-300 hover:text-white">恢复</button></div>)}</div>
        </details>}
      </div>

      <div className="p-3 border-t space-y-2" style={{ borderColor: "var(--border)" }}>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onOpenModelDrawer} className="py-1.5 rounded-md border mono text-[11px] text-zinc-300 hover:bg-[var(--bg-card)] flex items-center justify-center gap-1" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 模型 · {providerCount}/{modelCount}
          </button>
          <button onClick={onOpenExtensionDrawer} className="py-1.5 rounded-md border mono text-[11px] text-zinc-300 hover:bg-[var(--bg-card)] flex items-center justify-center gap-1" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
            <span className={`w-1.5 h-1.5 rounded-full ${extensionCount ? "bg-violet-500" : "bg-zinc-600"}`} /> 扩展 · {extensionCount}/{skillCount}
          </button>
        </div>
        <button onClick={onNewSession} className="w-full py-2 rounded-md text-[13px] font-medium" style={{ background: "#ededed", color: "#0a0a0a" }}>+ 新建会话 @ {curProject?.displayName ?? "—"}</button>
        <div className="mono text-[11px] text-zinc-600 text-center">
          回车发送 · ⇧回车换行 · Esc 中止{lastErrorCode ? ` · 最近错误 ${lastErrorCode}` : ""}
        </div>
      </div>
    </aside>
  )
}
