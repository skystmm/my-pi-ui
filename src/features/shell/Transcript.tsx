import { useRef, useState, type RefObject } from "react"
import type { SessionEntry, SessionMeta, SlashCommandEntry } from "../../lib/ws-protocol"
import { EntryView } from "../transcript/EntryView"
import type { StreamBuffer } from "../../stores/appStore"

export type Attachment = { name: string; mimeType: string; data: string }

type Props = {
  entries: SessionEntry[]
  stream: StreamBuffer
  leafId: string
  curSession: SessionMeta | null
  activeModelKey: string
  cwd: string
  projectDisplayName: string
  projectCount: number
  composerText: string
  slashCommands: SlashCommandEntry[]
  composerFocused: boolean
  composerMode: "plan" | "build"
  modeMenuOpen: boolean
  attachments: Attachment[]
  promptStatus: { kind: "sending" | "accepted" | "failed" | "unknown"; message: string } | null
  fileRef: RefObject<HTMLInputElement | null>
  onComposerText: (v: string) => void
  onComposerFocus: (v: boolean) => void
  onComposerMode: (m: "plan" | "build") => void
  onModeMenu: (open: boolean) => void
  onAttachFiles: (files: FileList | null) => void
  onRemoveAttachment: (index: number) => void
  onSend: () => void
  onAbort: () => void
}

export function Transcript(props: Props) {
  const {
    entries, stream, leafId, curSession, activeModelKey, cwd, projectDisplayName, projectCount,
    composerText, slashCommands, composerFocused, composerMode, modeMenuOpen, attachments, promptStatus, fileRef,
    onComposerText, onComposerFocus, onComposerMode, onModeMenu, onAttachFiles, onRemoveAttachment, onSend, onAbort,
  } = props
  const innerRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [commandIndex, setCommandIndex] = useState(0)
  const [commandsDismissed, setCommandsDismissed] = useState(false)
  const match = /^\/([^\s/]*)$/.exec(composerText)
  const commandMatches = match ? slashCommands.filter(c => c.name.toLowerCase().includes(match[1].toLowerCase())).slice(0, 30) : []
  const showCommands = composerFocused && !commandsDismissed && commandMatches.length > 0
  const chooseCommand = (command: SlashCommandEntry) => {
    onComposerText(`/${command.name} `)
    setCommandsDismissed(true)
    composerRef.current?.focus()
  }

  return (
    <main className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      <div className="flex-1 overflow-auto">
        <div ref={innerRef} className="max-w-[768px] mx-auto w-full px-4 sm:px-6 py-6 space-y-5">
          <div className="flex items-center gap-2 text-[12px] mono text-zinc-500">
            <span>{activeModelKey || "未配置模型"}</span>
            <span>·</span>
            <span>{curSession?.thinking ?? "—"}</span>
            <span>·</span>
            <span className="px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>{curSession ? `${curSession.entryCount} entries` : `${entries.length} entries`}</span>
            <span className="ml-auto hidden sm:inline">leaf · {leafId ? leafId.slice(0, 8) : "—"}</span>
          </div>

          {entries.length === 0 && !stream.text && !stream.thinking ? (
            <div className="mono text-[13px] text-zinc-500 border border-dashed rounded-xl p-6 text-center" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
              {curSession ? "此会话暂无消息 · 在下方 Composer 输入 prompt 开始" : projectCount ? "选中一个会话查看时间线" : "在终端 pi 启动一次会话，或打开项目目录"}
            </div>
          ) : (
            <>
              {entries.map(entry => <EntryView key={entry.id} entry={entry} />)}
              {(stream.text || stream.thinking) && (
                <div className="space-y-2">
                  {stream.thinking && (
                    <div className="px-3 py-2 rounded-lg border mono text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--bg-card)", borderColor: "var(--border)", color: "#b4b4b4" }}>
                      <span className="inline-flex items-center gap-1.5 mr-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
                        <span className="text-violet-300 text-[11px]">thinking</span>
                      </span>
                      {stream.thinking}
                    </div>
                  )}
                  {stream.text && (
                    <div className="px-1 text-[14px] leading-relaxed whitespace-pre-wrap">
                      {stream.text}
                      <span className="inline-block w-[7px] h-[15px] align-[-2px] ml-0.5 bg-sky-400 animate-pulse" />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className={`sticky bottom-4 mt-6 rounded-2xl border shadow-lg ${composerFocused ? "ring-1" : ""}`} style={{ background: "var(--bg-card)", borderColor: composerFocused ? "var(--border-strong)" : "var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.45)" }}>
            {promptStatus && <div role="status" className={`px-4 pt-2 mono text-[11px] ${promptStatus.kind === "failed" || promptStatus.kind === "unknown" ? "text-amber-400" : "text-zinc-400"}`}>{promptStatus.message}</div>}
            {showCommands && (
              <div role="listbox" aria-label="Pi 命令" className="absolute bottom-[calc(100%+8px)] left-0 right-0 max-h-72 overflow-auto rounded-xl border p-1 shadow-xl z-40" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
                {commandMatches.map((command, index) => (
                  <button key={`${command.source}:${command.name}`} type="button" role="option" aria-selected={index === commandIndex} onMouseDown={e => e.preventDefault()} onClick={() => chooseCommand(command)} className={`w-full text-left px-3 py-2 rounded-lg ${index === commandIndex ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]"}`}>
                    <span className="mono text-[13px] text-zinc-100">/{command.name}</span>
                    <span className="mono text-[10px] text-zinc-500 ml-2">{command.source}</span>
                    {command.description && <div className="text-[11px] text-zinc-400 truncate mt-0.5">{command.description}</div>}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={composerRef}
              value={composerText}
              disabled={promptStatus?.kind === "sending"}
              onChange={e => { onComposerText(e.target.value); setCommandIndex(0); setCommandsDismissed(false) }}
              onFocus={() => onComposerFocus(true)}
              onBlur={() => onComposerFocus(false)}
              placeholder="Ask anything, or try /plan  ·  提示：工具批次完成前 steering 不会注入"
              className="w-full bg-transparent px-4 pt-3 pb-2 text-[14px] placeholder:text-zinc-600 focus:outline-none resize-none"
              rows={2}
              onKeyDown={e => {
                if (showCommands && e.key === "ArrowDown") { e.preventDefault(); setCommandIndex(i => (i + 1) % commandMatches.length); return }
                if (showCommands && e.key === "ArrowUp") { e.preventDefault(); setCommandIndex(i => (i - 1 + commandMatches.length) % commandMatches.length); return }
                if (showCommands && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) { e.preventDefault(); chooseCommand(commandMatches[commandIndex] ?? commandMatches[0]); return }
                if (showCommands && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setCommandsDismissed(true); return }
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend() }
                if (e.key === "Escape" && cwd) onAbort()
              }}
            />
            <div className="flex items-center gap-2 px-3 pb-3">
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { onAttachFiles(e.target.files); e.target.value = "" }} />
              <button onClick={() => fileRef.current?.click()} disabled={promptStatus?.kind === "sending"} title="添加图片附件" className="w-7 h-7 grid place-items-center rounded-full border text-zinc-400 hover:text-zinc-200 disabled:opacity-40" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>⊕</button>
              {attachments.length > 0 && (
                <span className="flex items-center gap-1.5 max-w-[40%] overflow-x-auto">
                  {attachments.map((a, i) => (
                    <span key={`${a.name}-${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border mono text-[10px] text-zinc-300 whitespace-nowrap" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
                      🖼 {a.name.length > 14 ? a.name.slice(0, 12) + "…" : a.name}
                      <button onClick={() => onRemoveAttachment(i)} className="text-zinc-500 hover:text-zinc-200" title="移除">×</button>
                    </span>
                  ))}
                </span>
              )}
              <div className="relative">
                <button onClick={() => onModeMenu(!modeMenuOpen)} className="px-2.5 py-1 rounded-full border mono text-[12px] text-zinc-400 hover:text-zinc-200" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>{composerMode} ▾</button>
                {modeMenuOpen && (
                  <div className="absolute bottom-[calc(100%+8px)] left-0 w-[248px] rounded-lg border shadow-xl p-1 z-40" style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                    {([
                      ["plan", "plan · 规划先行", "发送时前加 /plan，模型先给方案再动手"],
                      ["build", "build · 直接执行", "原文发送，模型直接动手改代码"],
                    ] as const).map(([v, label, desc]) => (
                      <button key={v} onClick={() => { onComposerMode(v); onModeMenu(false) }} className="w-full text-left px-2.5 py-2 rounded-md hover:bg-[var(--bg-hover)]">
                        <div className="text-[12px] text-zinc-200">{composerMode === v ? "✓ " : ""}{label}</div>
                        <div className="mono text-[10px] text-zinc-500 mt-0.5">{desc}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="mono text-[11px] text-zinc-600 truncate max-w-[240px]" title={cwd || undefined}>
                {cwd ? `cwd ${cwd}` : "未打开项目"}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <span className="hidden sm:inline mono text-[11px] text-zinc-600">↵ 发送 · ⇧↵ 换行 · Esc 中止</span>
                <button onClick={onSend} disabled={promptStatus?.kind === "sending"} title={promptStatus?.kind === "failed" || promptStatus?.kind === "unknown" ? "重试发送" : "发送"} className="min-w-8 h-8 px-2 grid place-items-center rounded-full hover:opacity-90 disabled:opacity-40 mono text-[11px]" style={{ background: "#ededed", color: "#0a0a0a" }}>{promptStatus?.kind === "sending" ? "…" : promptStatus?.kind === "failed" || promptStatus?.kind === "unknown" ? "重试" : "▶"}</button>
              </span>
            </div>
          </div>

          <div className="mono text-[11px] text-zinc-600 text-center pb-2">
            pi 0.85 · {projectDisplayName} · {entries.length} entries · 数据来源 ~/.pi/agent/sessions 与 pi rpc
          </div>
        </div>
      </div>
    </main>
  )
}
