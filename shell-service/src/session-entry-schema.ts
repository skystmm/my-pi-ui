// Single source of truth for pi's session entry format — shared verbatim by the
// Shell Service and the frontend (mirrored to src/lib/session-entry-schema.ts by
// scripts/sync-protocol.mjs; `npm run check` fails if the copies drift).
//
// Mirrors @earendil-works/pi-coding-agent dist/core/session-manager.d.ts
// (CURRENT_SESSION_VERSION 3), dist/core/messages.d.ts and pi-ai types.d.ts.
// Entries are FLAT: a message entry carries `entry.message`, NOT `entry.payload`.
//
// This file must stay free of node/dom imports so both runtimes can use it.

// ---------------------------------------------------------------- messages

export interface TextContent { type: "text"; text: string; textSignature?: string }
export interface ThinkingContent { type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean }
export interface ImageContent { type: "image"; data: string; mimeType: string }
export interface ToolCall { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown>; thoughtSignature?: string; namespace?: string }

export interface Usage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens?: number
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
}

export interface UserMessage { role: "user"; content: string | (TextContent | ImageContent)[]; timestamp: number }
export interface AssistantMessage {
  role: "assistant"
  content: (TextContent | ThinkingContent | ToolCall)[]
  api?: string
  provider?: string
  model?: string
  responseModel?: string
  usage?: Usage
  stopReason?: string
  errorMessage?: string
  timestamp: number
}
export interface ToolResultMessage {
  role: "toolResult"
  toolCallId: string
  toolName: string
  content: (TextContent | ImageContent)[]
  details?: unknown
  isError: boolean
  timestamp: number
}
export interface CustomMessage { role: "custom"; customType: string; content: string | (TextContent | ImageContent)[]; display: boolean; details?: unknown; timestamp: number }
export interface BashExecutionMessage {
  role: "bashExecution"
  command: string
  output: string
  exitCode: number | undefined
  cancelled: boolean
  truncated: boolean
  fullOutputPath?: string
  timestamp: number
  excludeFromContext?: boolean
}
export interface BranchSummaryMessage { role: "branchSummary"; summary: string; fromId: string | null; timestamp: number }
export interface CompactionSummaryMessage { role: "compactionSummary"; summary: string; tokensBefore: number; timestamp: number }

export type AgentMessage =
  | UserMessage | AssistantMessage | ToolResultMessage
  | CustomMessage | BashExecutionMessage | BranchSummaryMessage | CompactionSummaryMessage

export type ContentBlock = TextContent | ThinkingContent | ImageContent | ToolCall

// ---------------------------------------------------------------- entries

export interface SessionHeader {
  type: "session"
  version?: number
  id: string
  timestamp: string
  cwd: string
  parentSession?: string
}

export interface SessionEntryBase { type: string; id: string; parentId: string | null; timestamp: string }

export interface SessionMessageEntry extends SessionEntryBase { type: "message"; message: AgentMessage }
export interface ThinkingLevelChangeEntry extends SessionEntryBase { type: "thinking_level_change"; thinkingLevel: string }
export interface ModelChangeEntry extends SessionEntryBase { type: "model_change"; provider: string; modelId: string }
export interface CompactionEntry extends SessionEntryBase {
  type: "compaction"; summary: string; firstKeptEntryId: string; tokensBefore: number
  details?: unknown; usage?: Usage; fromHook?: boolean
}
export interface BranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary"; fromId: string; summary: string; details?: unknown; usage?: Usage; fromHook?: boolean
}
export interface CustomEntry extends SessionEntryBase { type: "custom"; customType: string; data?: unknown }
export interface CustomMessageEntry extends SessionEntryBase {
  type: "custom_message"; customType: string; content: string | (TextContent | ImageContent)[]
  details?: unknown; display: boolean
}
export interface LabelEntry extends SessionEntryBase { type: "label"; targetId: string; label: string | undefined }
export interface SessionInfoEntry extends SessionEntryBase { type: "session_info"; name?: string }

export type SessionEntry =
  | SessionMessageEntry | ThinkingLevelChangeEntry | ModelChangeEntry
  | CompactionEntry | BranchSummaryEntry | CustomEntry | CustomMessageEntry
  | LabelEntry | SessionInfoEntry

export type FileEntry = SessionHeader | SessionEntry

// ---------------------------------------------------------------- helpers

export function isSessionHeader(e: FileEntry): e is SessionHeader { return e.type === "session" }
export function isSessionEntry(e: FileEntry): e is SessionEntry { return e.type !== "session" }

export function parseEntryLine(line: string): FileEntry | null {
  const t = line.trim()
  if (!t) return null
  try {
    const j = JSON.parse(t) as FileEntry
    return j && typeof j === "object" && typeof j.type === "string" && typeof j.id === "string" ? j : null
  } catch { return null }
}

/** Flatten a message's text blocks — mirrors pi's extractTextContent(). */
export function messageText(m: AgentMessage | undefined): string {
  if (!m) return ""
  switch (m.role) {
    case "user":
    case "custom": {
      const c = m.content
      if (typeof c === "string") return c
      return (c ?? []).filter((b): b is TextContent => b.type === "text").map(b => b.text).join(" ")
    }
    case "assistant":
      return (m.content ?? []).filter((b): b is TextContent => b.type === "text").map(b => b.text).join("")
    case "toolResult":
      return (m.content ?? []).filter((b): b is TextContent => b.type === "text").map(b => b.text).join("")
    case "bashExecution":
      return m.output ?? ""
    case "branchSummary":
    case "compactionSummary":
      return m.summary ?? ""
    default:
      // entries come from a file on disk: an unknown role is possible even when
      // the union is exhaustive, so never assume the narrowing is complete.
      return ""
  }
}

export function thinkingText(m: AgentMessage | undefined): string {
  if (!m || m.role !== "assistant") return ""
  return (m.content ?? []).filter((b): b is ThinkingContent => b.type === "thinking").map(b => b.thinking).join("\n\n")
}

export function toolCallsOf(m: AgentMessage | undefined): ToolCall[] {
  if (!m || m.role !== "assistant") return []
  return (m.content ?? []).filter((b): b is ToolCall => b.type === "toolCall")
}

/** One-line description of an entry for timeline rows / tree nodes. */
export function entryLabel(e: SessionEntry): string {
  switch (e.type) {
    case "message": {
      const m = e.message
      if (!m) return "message"
      if (m.role === "user") return "user"
      if (m.role === "assistant") return "assistant"
      if (m.role === "toolResult") return `tool · ${m.toolName}`
      if (m.role === "bashExecution") return "bash"
      if (m.role === "custom") return `custom · ${m.customType}`
      if (m.role === "branchSummary") return "branch summary"
      if (m.role === "compactionSummary") return "compaction summary"
      // entries come from a file on disk: an unknown role is possible even if
      // the union is exhaustive, so never assume the narrowing is complete.
      return String((m as { role?: unknown }).role ?? "message")
    }
    case "compaction": return "compaction"
    case "branch_summary": return "branch summary"
    case "model_change": return `model → ${e.provider}/${e.modelId}`
    case "thinking_level_change": return `thinking → ${e.thinkingLevel}`
    case "session_info": return e.name ? `title → ${e.name}` : "title cleared"
    case "label": return e.label ? `label · ${e.label}` : "label cleared"
    case "custom": return `custom · ${e.customType}`
    case "custom_message": return `message · ${e.customType}`
    default: return (e as SessionEntryBase).type
  }
}
