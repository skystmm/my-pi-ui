import { useState } from "react"
import {
  entryLabel, messageText, thinkingText, toolCallsOf,
  type SessionEntry, type AgentMessage, type ToolCall,
} from "../../lib/session-entry-schema"

/** JSON preview that can never throw — entries come from disk, not from us. */
function safeJson(v: unknown, max = 800): string {
  try {
    const s = JSON.stringify(v, null, 2)
    return (s ?? String(v)).slice(0, max)
  } catch { return "[unserializable]" }
}

function MetaRow({ entry }: { entry: SessionEntry }) {
  const dot =
    entry.type === "compaction" ? "bg-amber-500"
      : entry.type === "branch_summary" ? "bg-violet-500"
        : entry.type === "model_change" ? "bg-sky-500"
          : entry.type === "session_info" ? "bg-emerald-500"
            : "bg-zinc-600"
  return (
    <div className="flex items-center gap-2 px-1 mono text-[11px] text-zinc-500">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span className="truncate">{entryLabel(entry)}</span>
      <span className="ml-auto shrink-0 text-zinc-600">{entry.id.slice(0, 8)}</span>
    </div>
  )
}

function SummaryCard({ entry, tone }: { entry: SessionEntry & { summary?: string; firstKeptEntryId?: string; tokensBefore?: number; fromId?: string }; tone: "amber" | "violet" }) {
  const [open, setOpen] = useState(false)
  const accent = tone === "amber" ? "border-amber-500/20 bg-amber-500/5 text-amber-200" : "border-violet-500/20 bg-violet-500/5 text-violet-200"
  return (
    <div className={`rounded-lg border p-3 ${accent}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 text-left">
        <span className="mono text-[11px] font-medium">{entryLabel(entry)}</span>
        <span className="mono text-[10px] opacity-70">
          {entry.tokensBefore != null ? `tokens before ${entry.tokensBefore}` : ""}
          {entry.firstKeptEntryId ? ` · keeps from ${entry.firstKeptEntryId.slice(0, 8)}` : ""}
          {entry.fromId ? ` · from ${entry.fromId.slice(0, 8)}` : ""}
        </span>
        <span className="ml-auto mono text-[11px] opacity-70">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-2 mono text-[12px] leading-relaxed whitespace-pre-wrap opacity-90">
          {String(entry.summary ?? "")}
        </div>
      )}
    </div>
  )
}

function ThinkingBlock({ text, level, entryId }: { text: string; level?: string; entryId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(!open)} className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
        <span className="w-2 h-2 rounded-full bg-violet-500" />
        <span className="mono text-[12px] text-zinc-300">Thinking{level ? ` · ${level}` : ""}</span>
        <span className="mono text-[12px] text-zinc-500">{open ? "▴" : "▾"}</span>
        <span className="ml-auto mono text-[11px] text-zinc-600">{entryId.slice(0, 8)}</span>
      </button>
      {open && (
        <div className="px-3 py-2 rounded-lg border mono text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ background: "var(--bg-card)", borderColor: "var(--border)", color: "#b4b4b4" }}>
          {text}
        </div>
      )}
    </>
  )
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false)
  const args = safeJson(call.arguments, 600)
  return (
    <div className="rounded-lg border" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className="w-2 h-2 rounded-full bg-sky-500" />
        <span className="mono text-[12px] text-zinc-300 truncate">{call.name}</span>
        <span className="mono text-[10px] text-zinc-600 truncate hidden sm:inline">{Object.keys(call.arguments ?? {}).join(", ")}</span>
        <span className="ml-auto mono text-[11px] text-zinc-600">{open ? "▴" : "▾"}</span>
      </button>
      {open && <pre className="px-3 pb-2 mono text-[11px] text-zinc-400 whitespace-pre-wrap break-all">{args}</pre>}
    </div>
  )
}

function ToolResultCard({ message }: { message: AgentMessage & { role: "toolResult" } }) {
  const [open, setOpen] = useState(false)
  const text = messageText(message)
  return (
    <div className="rounded-lg border" style={{ background: "var(--bg)", borderColor: message.isError ? "rgba(239,68,68,0.25)" : "var(--border)" }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className={`w-2 h-2 rounded-full ${message.isError ? "bg-red-500" : "bg-emerald-500"}`} />
        <span className="mono text-[11px] text-zinc-400 truncate">{message.toolName}</span>
        <span className="mono text-[10px] text-zinc-600 truncate hidden sm:inline">{text.slice(0, 60)}</span>
        <span className="ml-auto mono text-[11px] text-zinc-600">{open ? "▴" : "▾"}</span>
      </button>
      {open && <pre className="px-3 pb-2 mono text-[11px] whitespace-pre-wrap break-all" style={{ color: message.isError ? "#fca5a5" : "#a3a3a3" }}>{text.slice(0, 4000)}</pre>}
    </div>
  )
}

function BashCard({ command, output, exitCode }: { command: string; output: string; exitCode?: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border p-2 mono text-[11px]" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 text-left">
        <span className="text-emerald-400">$</span>
        <span className="text-zinc-300 truncate">{command}</span>
        <span className="ml-auto text-zinc-600 shrink-0">{exitCode != null ? `exit ${exitCode}` : ""} {open ? "▴" : "▾"}</span>
      </button>
      {open && <pre className="mt-1 whitespace-pre-wrap break-all text-zinc-400">{output.slice(0, 4000)}</pre>}
    </div>
  )
}

/** One session entry → one timeline row. Never throws on unexpected shapes. */
export function EntryView({ entry }: { entry: SessionEntry }) {
  if (entry.type === "message") {
    const m = entry.message
    if (!m) return <MetaRow entry={entry} />

    if (m.role === "user") {
      const text = messageText(m)
      const images = Array.isArray(m.content) ? m.content.filter(b => b.type === "image").length : 0
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[14px] leading-relaxed" style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}>
            {text || <span className="mono text-[12px] text-zinc-500">[空消息]</span>}
            {images > 0 && <div className="mono text-[10px] text-zinc-500 mt-1.5">+{images} 张图片</div>}
          </div>
        </div>
      )
    }

    if (m.role === "assistant") {
      const thinking = thinkingText(m)
      const calls = toolCallsOf(m)
      const text = messageText(m)
      return (
        <div className="space-y-2">
          {thinking && <ThinkingBlock text={thinking} level={m.model} entryId={entry.id} />}
          {text && <div className="px-1 text-[14px] leading-relaxed whitespace-pre-wrap">{text}</div>}
          {m.errorMessage && (
            <div className="rounded-lg border p-2.5 mono text-[11px] text-red-300" style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.2)" }}>
              {m.errorMessage}{m.stopReason ? ` · stopReason ${m.stopReason}` : ""}
            </div>
          )}
          {calls.map(c => <ToolCallCard key={c.id} call={c} />)}
          <div className="mono text-[10px] text-zinc-600 px-1">
            {m.model ?? ""}{m.usage ? ` · ${m.usage.input}+${m.usage.output} tok` : ""}{m.stopReason ? ` · ${m.stopReason}` : ""}
          </div>
        </div>
      )
    }

    if (m.role === "toolResult") return <ToolResultCard message={m} />
    if (m.role === "bashExecution") return <BashCard command={m.command} output={m.output} exitCode={m.exitCode} />
    if (m.role === "branchSummary" || m.role === "compactionSummary") return <SummaryCard entry={{ ...entry, summary: m.summary, tokensBefore: "tokensBefore" in m ? m.tokensBefore : undefined }} tone={m.role === "branchSummary" ? "violet" : "amber"} />
    if (m.role === "custom") {
      return (
        <div className="rounded-lg border p-3" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
          <div className="mono text-[11px] text-zinc-500 mb-1">custom · {m.customType}</div>
          <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-zinc-300">{messageText(m)}</div>
        </div>
      )
    }
    return <MetaRow entry={entry} />
  }

  if (entry.type === "compaction") return <SummaryCard entry={entry} tone="amber" />
  if (entry.type === "branch_summary") return <SummaryCard entry={entry} tone="violet" />
  if (entry.type === "custom" || entry.type === "custom_message") {
    const body = entry.type === "custom_message" ? entry.content : entry.data
    return (
      <div className="rounded-lg border p-3" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
        <div className="mono text-[11px] text-zinc-500 mb-1">{entryLabel(entry)}</div>
        <pre className="mono text-[11px] text-zinc-400 whitespace-pre-wrap break-all">{typeof body === "string" ? body : safeJson(body, 600)}</pre>
      </div>
    )
  }
  // model_change / thinking_level_change / session_info / label / anything new
  return <MetaRow entry={entry} />
}
