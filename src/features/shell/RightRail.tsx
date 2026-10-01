import type { SessionEntry, ExtensionEntry, SkillEntry, SessionStats } from "../../lib/ws-protocol"
import { entryLabel } from "../../lib/session-entry-schema"
import { wsClient } from "../../lib/ws-client"
import { FilesTab } from "./FilesTab"
import { MemoryTab } from "./MemoryTab"
import { useMemorySuggestions } from "../../stores/appStore"
import type { SessionTreeRow } from "../../lib/session-tree"

export type RailTab = "tree" | "context" | "files" | "memory" | "extensions"

type Props = {
  tab: RailTab
  onTabChange: (t: RailTab) => void
  entries: SessionEntry[]
  leafId: string
  treeRows: SessionTreeRow[]
  forkableEntryId: string | null
  operationStatus: { operation: "fork" | "clone" | "compact"; kind: "sending" | "success" | "failed" | "unknown"; message: string } | null
  stats: SessionStats | null
  ctxPercent: number | null
  reserveLabel: string
  compactionCount: number
  fmtK: (n: number) => string
  extensions: ExtensionEntry[]
  skills: SkillEntry[]
  cwd: string
  sessionId: string
  onFork: (entryId: string) => void
  onClone: () => void
  onCompact: () => void
  onOpenExtensionDrawer: () => void
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border p-3 ${className}`} style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>{children}</div>
}

export function RightRail(props: Props) {
  const { tab, onTabChange, entries, leafId, treeRows, forkableEntryId, operationStatus, stats, ctxPercent, reserveLabel, compactionCount, fmtK, extensions, skills, cwd, sessionId, onFork, onClone, onCompact, onOpenExtensionDrawer } = props
  const memorySuggestions = useMemorySuggestions(cwd)

  return (
    <aside className="w-[360px] shrink-0 border-l flex flex-col overflow-hidden hidden lg:flex" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-1 p-2 border-b" style={{ borderColor: "var(--border)" }}>
        {(["tree", "context", "files", "memory", "extensions"] as const).map(t => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={`flex-1 py-1.5 rounded-md mono text-[10px] font-medium capitalize border ${tab === t ? "bg-[var(--bg-card)] border-[var(--border-strong)] text-zinc-200" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}
          >
            {t === "tree" ? "Tree" : t === "context" ? "Context" : t === "files" ? "Files" : t === "memory" ? `Memory${memorySuggestions.length ? ` · ${memorySuggestions.length}` : ""}` : "Ext"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {tab === "tree" && (
          <>
            <Card>
              <div className="mono text-[11px] text-zinc-500 mb-2">SESSION TREE · 全部分支 · {entries.length} entries</div>
              <div className="space-y-0.5 max-h-[420px] overflow-auto">
                {treeRows.length ? treeRows.map(row => (
                  <div key={row.entry.id} className={`flex items-center gap-1.5 py-1 pr-1 rounded-md mono text-[11px] ${row.entry.id === leafId ? "bg-[var(--bg-muted)] text-white" : row.active ? "text-zinc-300" : "text-zinc-500"}`} style={{ paddingLeft: `${Math.min(row.depth * 13 + 4, 130)}px` }} title={`${entryLabel(row.entry)} · ${row.entry.id}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.entry.type === "compaction" ? "bg-amber-500" : row.entry.type === "branch_summary" ? "bg-violet-500" : row.active ? "bg-emerald-500" : "bg-zinc-600"}`} />
                    <span className="truncate flex-1">{entryLabel(row.entry)} · {row.entry.id.slice(0, 8)}</span>
                    {row.childCount > 1 && <span className="text-sky-400 shrink-0" title="此处有多个子分支">↳{row.childCount}</span>}
                    {row.entry.id === leafId && <span className="text-zinc-400 shrink-0">leaf</span>}
                    {row.entry.type === "message" && row.entry.message.role === "user" && <button onClick={() => onFork(row.entry.id)} disabled={operationStatus?.kind === "sending"} className="text-[10px] text-sky-400 hover:text-sky-200 disabled:opacity-40 shrink-0" title="在这条用户消息之前创建分叉会话">fork</button>}
                  </div>
                )) : <span className="mono text-[11px] text-zinc-600">暂无节点</span>}
              </div>
              <div className="mono text-[11px] text-zinc-600 mt-3 leading-relaxed">
                亮色节点位于当前 leaf 路径；分叉节点显示子分支数量。fork 会在所选用户消息之前创建新会话。
              </div>
            </Card>

            <Card>
              <div className="mono text-[11px] text-zinc-500 mb-2">ACTIONS</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => { if (forkableEntryId) onFork(forkableEntryId) }}
                  disabled={!forkableEntryId || !cwd || operationStatus?.kind === "sending"}
                  title="从当前分支最近的用户消息创建分叉会话"
                  className="py-1.5 rounded-md border mono text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                  style={{ borderColor: "var(--border)", background: "var(--bg)" }}
                >fork</button>
                <button
                  onClick={onClone}
                  disabled={!cwd || !leafId || operationStatus?.kind === "sending"}
                  title="复制当前会话（pi rpc clone）"
                  className="py-1.5 rounded-md border mono text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                  style={{ borderColor: "var(--border)", background: "var(--bg)" }}
                >clone</button>
                <button onClick={onCompact} disabled={!cwd || !leafId || operationStatus?.kind === "sending"} className="py-1.5 rounded-md border mono text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-40" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>compact</button>
              </div>
              {operationStatus && <div role="status" className={`mono text-[11px] mt-2 ${operationStatus.kind === "failed" || operationStatus.kind === "unknown" ? "text-amber-400" : "text-zinc-400"}`}>{operationStatus.message}</div>}
              <div className="mono text-[10px] text-zinc-600 mt-2 leading-relaxed">
                Pi RPC 的 get_tree 只读；当前面板可查看分支并从用户节点 fork。
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

        {tab === "memory" && <MemoryTab cwd={cwd} sessionId={sessionId} />}

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
