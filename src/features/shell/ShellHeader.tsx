import type { ModelEntry, ProviderAccount, SessionMeta, SessionStats, ProjectMeta, ExtensionEntry, SkillEntry } from "../../lib/ws-protocol"
import { ModelMenu } from "../model-config"

type Props = {
  curProject: ProjectMeta | null
  curSession: SessionMeta | null
  projectCount: number
  stats: SessionStats | null
  ctxPercent: number | null
  reserveLabel: string
  providers: ProviderAccount[]
  models: ModelEntry[]
  activeModelKey: string
  extensions: ExtensionEntry[]
  skills: SkillEntry[]
  sidebarCollapsed: boolean
  railCollapsed: boolean
  onToggleSidebar: () => void
  onToggleRail: () => void
  onOpenExtensionDrawer: () => void
  onOpenModelDrawer: () => void
  onSelectModel: (m: ModelEntry) => void
  modelMenuRequest: number
  onTrustProject: () => void
}

export function ShellHeader(props: Props) {
  const {
    curProject, curSession, projectCount, stats, ctxPercent, reserveLabel,
    providers, models, activeModelKey, extensions, skills,
    sidebarCollapsed, railCollapsed, onToggleSidebar, onToggleRail,
    onOpenExtensionDrawer, onOpenModelDrawer, onSelectModel, modelMenuRequest, onTrustProject,
  } = props

  return (
    <header className="h-[48px] flex items-center gap-3 px-3 border-b shrink-0 sticky top-0 z-30" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
      <button onClick={onToggleSidebar} className="w-7 h-7 grid place-items-center rounded hover:bg-[var(--bg-hover)] text-zinc-400">
        <span className="mono text-[13px]">{sidebarCollapsed ? "»" : "≡"}</span>
      </button>
      <div className="flex items-center gap-2 text-[13px]">
        <span className="font-medium">{curProject?.displayName ?? "pi_ui"}</span>
        <span className="text-zinc-600">/</span>
        <span className="text-zinc-400 mono text-[12px]">
          {curSession ? curSession.title.slice(0, 28) + (curSession.title.length > 28 ? "…" : "") : projectCount ? "暂无会话" : "在终端 pi 启动一次会话或打开目录"}
        </span>
        {curProject && curProject.trust === "untrusted" && (
          <button onClick={onTrustProject} title="项目未信任：pi 不加载 .pi 资源，项目级写入被拒绝。点击信任。"
            className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px] border border-amber-500/20 hover:bg-amber-500/25">
            untrusted · 信任
          </button>
        )}
        {curProject && curProject.trust === "unknown" && (
          <span className="px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400 text-[10px] border border-zinc-500/20" title="pi 的 trust.json 里没有该目录的记录（默认按询问处理）">trust 未记录</span>
        )}
      </div>
      <div className="flex-1" />
      <div className="hidden sm:flex items-center gap-2" title={stats ? `input ${stats.tokens.input} · output ${stats.tokens.output} · cache ${stats.tokens.cacheRead + stats.tokens.cacheWrite}` : "等待 pi get_session_stats"}>
        <span className="text-[11px] text-zinc-500 mono">context {ctxPercent != null ? `${Math.round(ctxPercent)}%` : "—"}</span>
        <div className="w-[96px] h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
          <div className="h-full" style={{ width: `${ctxPercent ?? 0}%`, background: "#a1a1a1" }} />
        </div>
        <span className="text-[11px] text-zinc-600 mono">reserve {reserveLabel}</span>
      </div>
      <div className="h-5 w-px mx-2" style={{ background: "var(--border)" }} />
      <button onClick={onOpenExtensionDrawer} className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border mono text-[11px] hover:bg-[var(--bg-card)]" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }} title="扩展与技能">
        <span className={`w-1.5 h-1.5 rounded-full ${extensions.length ? "bg-emerald-500" : "bg-zinc-600"}`} />
        扩展 · {extensions.length} · {skills.length}
      </button>
      <ModelMenu
        providers={providers}
        models={models}
        activeModelKey={activeModelKey}
        onSelectModel={onSelectModel}
        openRequest={modelMenuRequest}
        onOpenDrawer={onOpenModelDrawer}
      />
      <button onClick={onToggleRail} className="w-7 h-7 grid place-items-center rounded border text-zinc-400 hover:text-zinc-200" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }} title="Toggle right rail">
        <span className="mono text-[12px]">{railCollapsed ? "◧" : "◨"}</span>
      </button>
    </header>
  )
}
