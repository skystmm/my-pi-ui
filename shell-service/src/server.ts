import { createServer } from "node:http"
import { statSync } from "node:fs"
import { WebSocket, type WebSocketServer } from "ws"
import { liveSessions } from "./pi-adapter/index.js"
import { watchProjects, canonCwd } from "./project-scanner.js"
import { watchSessions } from "./session-bridge/jsonl-watcher.js"
import { attachExtensionBridge } from "./extension-bridge.js"
import { providersSnapshot, modelsSnapshot, extensionsSnapshot, pathSkillsSnapshot } from "./snapshots.js"
import { broadcast, send, getOpenSession } from "./ws-util.js"
import { getActiveSession } from "./active-session.js"
import { learnActiveSession, pushSessionTail } from "./session-router.js"
import { scheduleStatsPush } from "./stats-push.js"
import * as sessionCmds from "./commands/session.js"
import * as agentCmds from "./commands/agent.js"
import * as providerCmds from "./commands/provider.js"
import * as extensionCmds from "./commands/extension.js"
import * as fileCmds from "./commands/files.js"
import { browseDirectories, createDirectory } from "./commands/browse-directories.js"
import { createGuardedWebSocketServer } from "./ws-access.js"
import type { Ctx } from "./commands/context.js"
import type { ShellEvent, ShellCommand, StreamDelta } from "./ws-protocol.js"

const PORT = Number(process.env.PI_UI_PORT ?? process.env.PORT ?? 5174)
const HOST = process.env.PI_UI_HOST ?? "127.0.0.1"

function catalogEvents(): ShellEvent[] {
  return [
    { t: "providers_snapshot", providers: providersSnapshot() },
    { t: "models_snapshot", models: modelsSnapshot() },
    { t: "extensions_snapshot", extensions: extensionsSnapshot() },
    { t: "skills_snapshot", skills: pathSkillsSnapshot() },
  ]
}

async function handleCommand(ctx: Ctx, cmd: ShellCommand): Promise<void> {
  switch (cmd.t) {
    // ---- projects & sessions ------------------------------------------------
    case "list_projects": return sessionCmds.listProjects(ctx)
    case "pick_project_directory": return sessionCmds.pickProjectDirectory(ctx)
    case "browse_directories": return browseDirectories(ctx, cmd)
    case "create_directory": return createDirectory(ctx, cmd)
    case "set_project_archived": return sessionCmds.archiveProject(ctx, cmd)
    case "set_session_archived": return sessionCmds.archiveSession(ctx, cmd)
    case "trust_project": return sessionCmds.trustProject(ctx, cmd)
    case "open_project": return sessionCmds.openProject(ctx, cmd)
    case "list_sessions": return sessionCmds.listSessions(ctx, cmd)
    case "get_session": return sessionCmds.getSession(ctx, cmd)
    case "create_session": return sessionCmds.createSession(ctx, cmd)
    // ---- agent --------------------------------------------------------------
    case "prompt": return agentCmds.prompt(ctx, cmd)
    case "steer": return agentCmds.steer(ctx, cmd)
    case "abort": return agentCmds.abort(ctx, cmd)
    case "set_model": return agentCmds.setModel(ctx, cmd)
    case "set_thinking": return agentCmds.setThinking(ctx, cmd)
    case "fork": return agentCmds.fork(ctx, cmd)
    case "clone": return agentCmds.clone(ctx, cmd)
    case "compact": return agentCmds.compact(ctx, cmd)
    case "navigate_tree": return agentCmds.navigateTree(ctx, cmd)
    // ---- providers & models -------------------------------------------------
    case "upsert_provider": return providerCmds.upsertProvider(ctx, cmd)
    case "remove_provider": return providerCmds.removeProvider(ctx, cmd)
    case "test_provider": return providerCmds.testProvider(ctx, cmd)
    case "upsert_model": return providerCmds.upsertModel(ctx, cmd)
    case "remove_model": return providerCmds.removeModel(ctx, cmd)
    case "list_available_models": return providerCmds.listAvailableModels(ctx, cmd)
    case "set_default_model": return providerCmds.setDefaultModel(ctx, cmd)
    // ---- extensions & skills ------------------------------------------------
    case "list_extensions": return extensionCmds.listExtensions(ctx, cmd)
    case "list_skills": return extensionCmds.listSkills(ctx, cmd)
    case "list_slash_commands": return extensionCmds.listSlashCommands(ctx, cmd)
    case "install_extension": return extensionCmds.installExtension(ctx, cmd)
    case "remove_extension": return extensionCmds.removeExtension(ctx, cmd)
    case "set_extension_enabled": return extensionCmds.setExtensionEnabled(ctx, cmd)
    case "invoke_skill": return extensionCmds.invokeSkill(ctx, cmd)
    case "extension_ui_response": return extensionCmds.extensionUiResponse(ctx, cmd)
    case "extension_command": return extensionCmds.extensionCommand(ctx, cmd)
    // ---- files --------------------------------------------------------------
    case "list_dir": return fileCmds.listDir(ctx, cmd)
    default: return
  }
}

function makeCtx(ws: WebSocket, wss: WebSocketServer): Ctx {
  return {
    ws, wss,
    send: (event) => send(ws, event),
    broadcast: (event) => broadcast(wss, event),
    fail: (code, message) => send(ws, { t: "error", code, message }),
    cwdOrError: async (raw, missingMsg) => {
      const input = (raw ?? "").trim()
      if (!input) { send(ws, { t: "error", code: "missing_cwd", message: missingMsg }); return null }
      const cwd = canonCwd(input)
      let ok = false
      try { ok = statSync(cwd).isDirectory() } catch {}
      if (!ok) { send(ws, { t: "error", code: "cwd_not_found", message: `目录不存在：${input}（请检查路径或先创建该目录）` }); return null }
      return cwd
    },
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return }
  res.writeHead(404); res.end("not found")
})

const wss = createGuardedWebSocketServer(httpServer)

attachExtensionBridge(wss)

wss.on("connection", (ws) => {
  send(ws, { t: "projects_snapshot", projects: sessionCmds.projectsSnapshot() })
  for (const ev of catalogEvents()) send(ws, ev)

  ws.on("message", (data) => {
    let msg: unknown
    try { msg = JSON.parse(data.toString()) } catch {
      send(ws, { t: "error", code: "invalid_json", message: "invalid json" })
      return
    }
    const cmd = msg as ShellCommand
    if (!cmd || typeof cmd !== "object" || typeof (cmd as { t?: unknown }).t !== "string") {
      send(ws, { t: "error", code: "invalid_command", message: "missing command type" })
      return
    }
    void handleCommand(makeCtx(ws, wss), cmd).catch((e) => {
      const err = e as Error & { code?: string }
      send(ws, { t: "error", code: err.code ?? "internal_error", message: err.message ?? String(e) })
    })
  })
})

watchProjects(() => {
  broadcast(wss, { t: "projects_snapshot", projects: sessionCmds.projectsSnapshot() })
})

watchSessions(async (projectId) => {
  broadcast(wss, { t: "session_list", projectId, sessions: await sessionCmds.sessionsWithPending(projectId) })
  // tail-follow every session a client currently has open in this project
  const open = new Map<string, string>() // sessionId → projectId
  for (const client of wss.clients) {
    const o = getOpenSession(client as WebSocket)
    if (o && o.projectId === projectId) open.set(o.sessionId, o.projectId)
  }
  for (const sessionId of open.keys()) void pushSessionTail(wss, projectId, sessionId)
})

// Streaming text arrives as `message_update` deltas; entry-level truth is pulled
// from the session file at message_end (pi does not emit entry_appended over rpc).
function normalizeStreamDelta(ev: Record<string, unknown>): StreamDelta | null {
  const ame = ev["assistantMessageEvent"] as Record<string, unknown> | undefined
  if (!ame || typeof ame["type"] !== "string") return null
  switch (ame["type"]) {
    case "text_delta": return { kind: "text", text: String(ame["delta"] ?? "") }
    case "thinking_delta": return { kind: "thinking", text: String(ame["delta"] ?? "") }
    case "toolcall_start": return { kind: "tool", id: String(ame["id"] ?? ""), name: String(ame["toolName"] ?? "") }
    case "done": return { kind: "done" }
    case "error": {
      const err = ame["error"] as { errorMessage?: unknown } | undefined
      return { kind: "error", message: String(err?.errorMessage ?? "stream error") }
    }
    default: return null
  }
}

function clientWatching(cwd: string) {
  for (const client of wss.clients) {
    const o = getOpenSession(client as WebSocket)
    if (o && o.cwd === cwd) return o
  }
  return undefined
}

liveSessions.on((ev) => {
  if (ev.t === "agent_event") {
    const payload = ev.payload as Record<string, unknown>
    const kind = typeof payload?.["type"] === "string" ? payload["type"] : ""
    if (kind === "message_update") {
      const delta = normalizeStreamDelta(payload)
      if (!delta) return
      const sessionId = getActiveSession(ev.cwd) ?? ""
      if (!sessionId) void learnActiveSession(ev.cwd)
      if (sessionId) {
        for (const client of wss.clients) {
          const o = getOpenSession(client as WebSocket)
          if (o?.sessionId === sessionId) send(client as WebSocket, { t: "session_stream", cwd: ev.cwd, sessionId, delta })
        }
      }
      return
    }
    if (kind === "message_end" || kind === "turn_end" || kind === "agent_settled") {
      const sessionId = getActiveSession(ev.cwd) ?? ""
      if (!sessionId) void learnActiveSession(ev.cwd)
      const open = clientWatching(ev.cwd)
      if (open) void pushSessionTail(wss, open.projectId, open.sessionId)
      scheduleStatsPush(wss, ev.cwd)
      return
    }
    broadcast(wss, { t: "agent_event", cwd: ev.cwd, event: payload })
    scheduleStatsPush(wss, ev.cwd)
    return
  }
  if (ev.t === "rpc_error") {
    broadcast(wss, { t: "rpc_error", cwd: ev.cwd, message: (ev.payload as { message: string }).message })
  }
})

httpServer.listen(PORT, HOST, () => {
  console.log(`[shell-service] listening on http://${HOST}:${PORT} (ws /ws)`)
})
httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[shell-service] port ${PORT} in use — try PI_UI_PORT=... npm run dev --prefix shell-service`)
    process.exit(1)
  }
  throw err
})
