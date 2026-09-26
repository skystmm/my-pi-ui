import type { SessionEntry, ExtensionEntry, SkillEntry, SessionStats } from "../../lib/ws-protocol"
import { entryLabel } from "../../lib/session-entry-schema"
import { wsClient } from "../../lib/ws-client"
import { FilesTab } from "./FilesTab"

export type RailTab = "tree" | "context" | "files" | "extensions"

type Props = {
  tab: RailTab
  onTabChange: (t: RailTab) => void
  entries: SessionEntry[]
  leafId: string
  branchPath: SessionEntry[]
  stats: SessionStats | null
  ctxPercent: number | null
  reserveLabel: string
  compactionCount: number
  fmtK: (n: number) => string
  extensions: ExtensionEntry[]
  skills: SkillEntry[]
  cwd: string
  onFork: () => void
  onClone: () => void
  onOpenExtensionDrawer: () => void
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border p-3 ${className}`} style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>{children}</div>
}

export function RightRail(props: Props) {
  const { tab, onTabChange, entries, leafId, branchPath, stats, ctxPercent, reserveLabel, compactionCount, fmtK, extensions, skills, cwd, onFork, onClone, onOpenExtensionDrawer } = props

  return (
    <aside className="w-[360px] shrink-0 border-l flex flex-col overflow-hidden hidden lg:flex" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-1 p-2 border-b" style={{ borderColor: "var(--border)" }}>
        {(["tree", "context", "files", "extensions"] as const).map(t => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={`flex-1 py-1.5 rounded-md mono text-[10px] font-medium capitalize border ${tab === t ? "bg-[var(--bg-card)] border-[var(--border-strong)] text-zinc-200" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}
          >
            {t === "tree" ? "Session Tree" : t === "context" ? "Context" : t === "files" ? "Files" : "Ext"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {tab === "tree" && (
          <>
            <Card>
              <div className="mono text-[11px] text-zinc-500 mb-2">SESSION TREE · leaf→root 链 · {entries.length} entries</div>
              <div className="space-y-1.5 max-h-[320px] overflow-auto">
                {branchPath.length ? branchPath.map((e, i) => (
                  <div key={e.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-md border mono text-[11px] ${e.id === leafId ? "border-zinc-600 bg-[var(--bg-muted)] text-white" : "border-transparent hover:bg-[var(--bg-muted)] text-zinc-400"}`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${e.type === "compaction" ? "bg-amber-500" : e.type === "branch_summary" ? "bg-violet-500" : e.type === "message" ? "bg-emerald-500" : "bg-zinc-500"}`} />
                    <span className="truncate">{entryLabel(e)} · {e.id.slice(0, 8)}</span>
                    {i === branchPath.length - 1 && <span className="ml-auto shrink-0 text-zinc-500">leaf</span>}
                  </div>
                )) : <span className="mono text-[11px] text-zinc-600">暂无节点</span>}
              </div>
              <div className="mono text-[11px] text-zinc-600 mt-3 leading-relaxed">
                存储层无损（JSONL 全量）· 推理层有损可视化：<br />
                <span className="text-zinc-400">compaction</span> 标注 <span className="text-zinc-300">firstKeptEntryId</span>，可展开原始历史
              </div>
            </Card>

            <Card>
              <div className="mono text-[11px] text-zinc-500 mb-2">ACTIONS</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onFork}
                  disabled={!leafId || !cwd}
                  title="以当前 leaf 为分叉点开新会话（pi rpc fork）"
                  className="py-1.5 rounded-md border mono text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                  style={{ borderColor: "var(--border)", background: "var(--bg)" }}
                >fork · leaf</button>
                <button
                  onClick={onClone}
                  disabled={!cwd}
                  title="复制当前会话（pi rpc clone）"
                  className="py-1.5 rounded-md border mono text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                  style={{ borderColor: "var(--border)", background: "var(--bg)" }}
                >clone</button>
              </div>
              <div className="mono text-[10px] text-zinc-600 mt-2 leading-relaxed">
                pi rpc 未提供「切换 leaf」命令（get_tree 只读），因此这里不提供 /tree 跳转
              </div>
            </Card>
          </>
        )}

        {tab === "context" && (
          <>
            <Card>
              <div className="flex items-center justify-between mb-2">
                <span className="mono text-[11px] text-zinc-500">CONTEXT METER</span>
                <span className="mono text-[11px] text-zinc-400">
                  {ctxPercent != null && stats?.contextUsage?.tokens != null
                    ? `${Math.round(ctxPercent)}% · ${fmtK(stats.contextUsage.tokens)} / ${fmtK(stats.contextUsage.contextWindow)}`
                    : stats?.contextUsage ? "compaction 后 · 等待下一次响应" : "未配置模型 · 暂无数据"}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden flex" style={{ background: "var(--border)" }}>
                <div className="h-full" style={{ width: `${ctxPercent ?? 0}%`, background: "#a1a1a1" }} />
                <div className="h-full w-px" style={{ background: "#f59e0b" }} title={`reserve ${reserveLabel}`} />
              </div>
              <div className="flex gap-1 mt-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className={`flex-1 h-1.5 rounded-full ${i < Math.min(compactionCount, 3) ? "bg-amber-500" : "bg-zinc-700"}`} title={compactionCount ? `compaction × ${compactionCount}` : "暂无 compaction 记录"} />
                ))}
              </div>
              <div className="mono text-[11px] text-zinc-600 mt-2">触发：estimated &gt; window − {reserveLabel} · 切点吸附合法边界</div>
            </Card>

            <Card>
              <div className="mono text-[11px] text-zinc-500 mb-2">COST</div>
              <div className="flex items-end gap-2">
                <span className="mono text-[18px] font-medium">{stats ? `$${stats.cost.toFixed(3)}` : "—"}</span>
                <span className="mono text-[11px] text-zinc-500 mb-1">{stats ? `${fmtK(stats.tokens.input)} in · ${fmtK(stats.tokens.output)} out · cache ${fmtK(stats.tokens.cacheRead + stats.tokens.cacheWrite)}` : "暂无用量数据"}</span>
              </div>
              <div className="mono text-[11px] text-zinc-600">数据来自 pi get_session_stats() · 含 cacheRead/cacheWrite 分项</div>
            </Card>

            <Card>
              <div className="mono text-[11px] text-zinc-500 mb-2">MESSAGES</div>
              <div className="mono text-[11px] text-zinc-400 leading-relaxed">
                {stats ? `${stats.counts.userMessages} user · ${stats.counts.assistantMessages} assistant · ${stats.counts.toolCalls} tool calls · ${stats.counts.totalMessages} total` : "—"}
              </div>
            </Card>
          </>
        )}

        {tab === "files" && (
          <>
            <FilesTab cwd={cwd} />
            <Card>
              <div className="px-3 py-2 mono text-[11px] text-zinc-500 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
                <span>DIFF PREVIEW</span>
              </div>
              <div className="mono text-[11px] text-zinc-600 leading-relaxed">
                pi 的 rpc 事件流没有文件改动通道（改动只存在于工具调用参数里），因此这里不展示 diff。
                需要看改动时，在终端用 git diff，或在对话里展开工具调用卡片。
              </div>
            </Card>
            <Card>
              <div className="mono text-[11px] text-zinc-500 mb-2">TERMINAL</div>
              <div className="mono text-[11px] text-zinc-600 leading-relaxed">
                未接入。pi rpc 提供 <span className="text-zinc-400">bash</span> 命令，接入后这里可以跑真实命令并回显 stdout/exit code。
              </div>
            </Card>
          </>
        )}

        {tab === "extensions" && (
          <div className="space-y-3">
            <Card>
              <div className="mono text-[11px] text-zinc-500 mb-2">EXTENSIONS · {extensions.length}</div>
              {extensions.length ? extensions.map(e => (
                <div key={e.id} className="flex items-center gap-2 py-1.5 border-b last:border-0 mono text-[11px]" style={{ borderColor: "var(--border)" }}>
                  <span className={`w-1.5 h-1.5 rounded-full ${e.enabled ? "bg-emerald-500" : "bg-zinc-600"}`} />
                  <span className="flex-1 truncate text-zinc-300">{e.name}</span>
                  <span className="text-[10px] px-1 py-0.5 rounded border" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>{e.source === "npm" ? "packages" : "extensions"}</span>
                </div>
              )) : <div className="mono text-[11px] text-zinc-600 text-center py-2 border border-dashed rounded" style={{ borderColor: "var(--border)" }}>pi 配置里暂无扩展</div>}
            </Card>
            <Card>
              <div className="mono text-[11px] text-zinc-500 mb-2">SKILLS · {skills.length}</div>
              {skills.length ? skills.map(s => (
                <div key={s.id} className="flex items-center gap-2 py-1.5 border-b last:border-0 mono text-[11px]" style={{ borderColor: "var(--border)" }}>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.enabled ? "bg-sky-500" : "bg-zinc-600"}`} />
                  <span className="flex-1 truncate text-zinc-300">{s.name}</span>
                  <button onClick={() => wsClient.send({ t: "invoke_skill", skillId: s.name, cwd })} disabled={!cwd} className="text-[10px] px-1.5 py-0.5 rounded border hover:bg-[var(--bg-hover)] disabled:opacity-40" style={{ borderColor: "var(--border)" }}>调用</button>
                </div>
              )) : <div className="mono text-[11px] text-zinc-600 text-center py-2 border border-dashed rounded" style={{ borderColor: "var(--border)" }}>暂无技能 · 打开项目后从 pi get_commands 拉取</div>}
            </Card>
            <button onClick={onOpenExtensionDrawer} className="w-full py-1.5 rounded-md border mono text-[11px] hover:bg-[var(--bg-hover)]" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>管理扩展与技能 →</button>
          </div>
        )}
      </div>
    </aside>
  )
}
