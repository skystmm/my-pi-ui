// GENERATED — do not edit. Source: shell-service/ws-protocol.ts
// Regenerate with: npm run sync:protocol
import type { Config as DecisionConfig, Draft as DecisionDraft } from "./system-one/types"
// Shared ShellEvent / ShellCommand — mirrors docs/architecture §5
import type { SessionEntry } from "./session-entry-schema"

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
export type ProviderType =
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "moonshot"
  | "openai-compatible"
  | "ollama"
  | "custom"

/**
 * A provider as the drawer submits it. Provider definitions are global in pi
 * (there is no project-level models.json), so there is no scope here — project
 * scope only applies to extensions/skills.
 */
export type ProviderDraftInput = {
  name: string
  type: ProviderType
  baseUrl?: string
  auth: "apiKey" | "oauth" | "env"
  apiKey?: string
  envVar?: string
  models?: ModelDraftInput[]
}

export type ModelDraftInput = {
  id: string
  displayName?: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
}

// pi's extension/skill resources are configured as path arrays
// (settings.extensions / settings.skills) plus npm packages (settings.packages),
// so an entry is "configured resource" rather than an installed artifact.
export type ExtensionEntry = {
  id: string
  name: string
  /** local path entry vs npm/git package entry */
  source: "local" | "npm"
  /** the configured value (path or package name); the stable identity */
  path: string
  scope: "global" | "project"
  /** present in the settings array == enabled (that is pi's own toggle) */
  enabled: boolean
}

export type SkillEntry = {
  id: string
  name: string
  path?: string
  scope?: "global" | "project"
  enabled: boolean
  /** where the entry came from: a skills path, a package, or pi's slash-command list */
  source: "path" | "package" | "rpc"
  description?: string
}

export type SlashCommandEntry = {
  name: string
  description?: string
  source: "builtin" | "extension" | "prompt" | "skill"
}

export type ProjectMeta = {
  id: string
  archived?: boolean
  cwd: string
  displayName: string
  trust: "trusted" | "untrusted" | "unknown"
  sessionCount: number
  lastActiveAt: number
  settingsOverride: boolean
  localExtensions: string[]
  localSkills?: string[]
}

export type SessionMeta = {
  id: string
  archived?: boolean
  fileName: string
  /** session_info name, else the first user message, else the file name */
  title: string
  model: string
  thinking: string
  mtime: number
  /** real entry count parsed from the JSONL (0 while pi has not flushed yet) */
  entryCount: number
  hasCompaction: boolean
  hasBranch: boolean
  leafId?: string
  projectId?: string
}

export type ProviderAccount = {
  /** pi provider id — the key in models.json and auth.json */
  id: string
  name: string
  type: ProviderType
  baseUrl?: string
  apiKeyMasked: string
  auth: "apiKey" | "oauth" | "env"
  envVar?: string
  status: "connected" | "missing_key" | "error"
  /** api declared in models.json, when the provider has an entry there */
  api?: string
  modelIds: string[]
}

export type ModelEntry = {
  id: string
  providerId: string
  displayName: string
  thinkingDefault: ThinkingLevel
  compat: string[]
  pricing: string
  /** pi reported it as usable (get_available_models); otherwise configured but unusable */
  available?: boolean
  contextWindow?: number
}

// pi's real on-disk entry shape (flat, discriminated on `type`). Re-exported so
// the frontend mirror stays identical without redeclaring it.
export type { SessionEntry } from "./session-entry-schema"
export type Entry = SessionEntry

export type SessionStats = {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  cost: number
  counts: { userMessages: number; assistantMessages: number; toolCalls: number; toolResults: number; totalMessages: number }
  // mirrors pi getContextUsage(): null when model has no contextWindow (unconfigured),
  // {tokens:null,...} right after compaction until the next assistant response
  contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | null
  // mirrors pi settings compaction.reserveTokens (default 16384); compaction triggers at contextTokens > contextWindow - reserveTokens
  reserveTokens: number
}

// Normalized subset of pi's AssistantMessageEvent (message_update). Only the
// deltas the transcript renders are forwarded — `partial` is dropped because it
// is superseded by the authoritative entry_appended payload.
export type StreamDelta =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string }
  | { kind: "done" }
  | { kind: "error"; message: string }

export type ShellEvent =
  | { t: "decision_selection"; cwd: string; selection: { scope: string; modelId?: string | null } }
  | { t: "decision_catalog"; config: DecisionConfig }
  | { t: "decision_result"; requestId: string; ok: boolean; code?: string; result?: unknown; config?: DecisionConfig; selection?: { scope: string; modelId?: string | null } }
  | { t: "projects_snapshot"; projects: ProjectMeta[] }
  | { t: "project_directory_picker"; status: "selected"; cwd: string }
  | { t: "project_directory_picker"; status: "cancelled" | "error"; message?: string }
  | { t: "project_opened"; projectId: string; cwd: string }
  | { t: "browse_directories_result"; cwd: string; parent: string | null; directories: string[]; truncated: boolean }
  | { t: "directory_created"; cwd: string }
  | { t: "session_list"; projectId: string; sessions: SessionMeta[] }
  | { t: "session_snapshot"; sessionId: string; projectId: string; cwd: string; leafId: string; entries: Entry[]; model: string; thinkingLevel: string }
  | { t: "providers_snapshot"; providers: ProviderAccount[] }
  | { t: "models_snapshot"; models: ModelEntry[] }
  | { t: "provider_test_result"; providerId: string; ok: boolean; latencyMs?: number; error?: { code: string; message: string } }
  | { t: "provider_saved"; providerId: string; name: string; models: string[] }
  // pi's get_available_models — the models whose credentials actually resolve
  | { t: "available_models"; cwd: string; models: { provider: string; id: string; name?: string; contextWindow?: number; reasoning?: boolean }[] }
  | { t: "extensions_snapshot"; extensions: ExtensionEntry[] }
  | { t: "skills_snapshot"; skills: SkillEntry[] }
  | { t: "slash_commands"; cwd: string; commands: SlashCommandEntry[] }
  | { t: "extension_ui_request"; cwd: string; requestId: string; extensionId?: string; kind: "select" | "confirm" | "input" | "notify" | "setStatus" | "setWidget" | "editor"; data: unknown }
  | { t: "extension_result"; requestId: string; ok: boolean; error?: string }
  | { t: "agent_event"; cwd: string; event: unknown }
  // Live transcript increments, forwarded from pi rpc: one appended SessionEntry,
  // and streaming assistant deltas between entries.
  | { t: "session_entry"; cwd: string; sessionId: string; entry: SessionEntry }
  | { t: "session_stream"; cwd: string; sessionId: string; delta: StreamDelta }
  | { t: "rpc_error"; cwd: string; message: string }
  | { t: "session_created"; projectId: string; sessionId: string; cwd: string }
  // pi's adapter was switched to the session the client is viewing
  | { t: "session_switched"; cwd: string; sessionId: string; model: string; thinkingLevel: string }
  | { t: "model_changed"; cwd: string; provider: string; modelId: string; thinkingLevel: string }
  // pi's get_tree output (SessionTreeNode[]), read-only: rpc has no leaf switch
  | { t: "session_tree"; cwd: string; tree: unknown }
  | { t: "dir_listing"; cwd: string; path: string; entries: { name: string; type: "dir" | "file"; size: number; mtime: number }[]; truncated: boolean }
  | { t: "session_stats"; cwd: string; sessionId: string; stats: SessionStats }
  | { t: "error"; code: string; message: string }

export type ShellCommand =
  | { t: "decision_command"; action: "list" | "save" | "select" | "test"; requestId: string; cwd?: string; config?: DecisionDraft; modelId?: string | null }
  | { t: "list_projects" }
  | { t: "pick_project_directory" }
  | { t: "browse_directories"; path?: string }
  | { t: "create_directory"; parent: string; name: string }
  | { t: "set_project_archived"; projectId: string; archived: boolean }
  | { t: "set_session_archived"; projectId: string; sessionId: string; archived: boolean }
  | { t: "list_sessions"; projectId: string }
  | { t: "get_session"; projectId: string; sessionId: string }
  | { t: "trust_project"; cwd: string; trusted: boolean }
  | { t: "open_project"; cwd: string }
  | { t: "create_session"; cwd: string }
  | { t: "fork"; cwd: string; fromEntryId: string }
  | { t: "navigate_tree"; cwd: string; targetEntryId: string; summarize?: boolean }
  | { t: "clone"; cwd: string }
  | { t: "set_model"; cwd: string; modelId: string }
  | { t: "set_thinking"; cwd: string; level: ThinkingLevel }
  | { t: "compact"; cwd: string; customInstructions?: string }
  | { t: "prompt"; cwd: string; projectId?: string; sessionId?: string; message: string; images?: unknown[] }
  | { t: "steer"; cwd: string; message: string; images?: unknown[] }
  | { t: "abort"; cwd: string }
  | { t: "upsert_provider"; provider: ProviderDraftInput }
  | { t: "remove_provider"; providerId: string }
  | { t: "test_provider"; providerIdOrDraft: string | { type: ProviderType; baseUrl?: string; apiKey?: string } }
  | { t: "upsert_model"; providerId: string; model: ModelDraftInput }
  | { t: "remove_model"; providerId: string; modelId: string }
  | { t: "list_available_models"; cwd: string }
  | { t: "set_default_model"; cwd?: string; provider: string; modelId: string; thinking?: ThinkingLevel }
  | { t: "list_extensions"; scope?: "global" | "project"; cwd?: string }
  | { t: "list_skills"; scope?: "global" | "project"; cwd?: string }
  | { t: "list_slash_commands"; cwd: string }
  | { t: "install_extension"; source: string; scope: "global" | "project"; cwd?: string; name?: string }
  | { t: "remove_extension"; source: string; scope: "global" | "project"; cwd?: string }
  | { t: "set_extension_enabled"; source: string; enabled: boolean; scope: "global" | "project"; cwd?: string }
  | { t: "invoke_skill"; skillId: string; cwd: string; args?: unknown }
  // real filesystem listing, restricted to a project the client has open
  | { t: "list_dir"; cwd: string; path?: string }
  | { t: "extension_ui_response"; requestId: string; result?: unknown; cancelled?: boolean; cwd?: string }
  | { t: "extension_command"; extensionId: string; command: string; args?: unknown; cwd: string }
