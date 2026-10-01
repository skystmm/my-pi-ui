import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { clone, compact, fork } from "../src/commands/agent.js"
import { liveSessions } from "../src/pi-adapter/index.js"
import { pidForCwd, registerPidCwd } from "../src/project-scanner.js"
import type { Ctx } from "../src/commands/context.js"
import type { ShellEvent } from "../src/ws-protocol.js"

test("session operations report success, cancellation and failure, and select a new session", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-operations-"))
  const cwd = join(root, "project")
  const pid = pidForCwd(cwd)
  mkdirSync(join(root, "sessions", pid), { recursive: true })
  mkdirSync(cwd)
  const entry = join(root, "fake-rpc.mjs")
  writeFileSync(entry, `import { createInterface } from "node:readline";
for await (const line of createInterface({ input: process.stdin })) {
  const cmd = JSON.parse(line);
  const data = cmd.type === "get_state" ? { sessionId: "child-session", model: "", thinkingLevel: "" } : cmd.type === "fork" ? { cancelled: true } : { cancelled: false };
  process.stdout.write(JSON.stringify({ type: "response", id: cmd.id, command: cmd.type, success: cmd.type !== "compact", data, error: "Nothing to compact" }) + "\\n");
}`)
  const previousAgent = process.env.PI_CODING_AGENT_DIR
  const previousSessions = process.env.PI_CODING_AGENT_SESSION_DIR
  const previousEntry = process.env.PI_UI_PI_ENTRY
  const sent: ShellEvent[] = []
  const broadcast: ShellEvent[] = []
  const ctx = {
    ws: {}, wss: {},
    cwdOrError: async () => cwd,
    send: (event: ShellEvent) => sent.push(event),
    broadcast: (event: ShellEvent) => broadcast.push(event),
  } as unknown as Ctx
  try {
    process.env.PI_CODING_AGENT_DIR = root
    delete process.env.PI_CODING_AGENT_SESSION_DIR
    process.env.PI_UI_PI_ENTRY = entry
    registerPidCwd(pid, cwd)
    await clone(ctx, { t: "clone", requestId: "clone-1", cwd })
    assert.ok(sent.some(event => event.t === "session_operation_result" && event.requestId === "clone-1" && event.ok && event.sessionId === "child-session"))
    assert.ok(sent.some(event => event.t === "session_created" && event.sessionId === "child-session"))
    assert.ok(broadcast.some(event => event.t === "session_list" && event.sessions.some(session => session.id === "child-session")))

    await fork(ctx, { t: "fork", requestId: "fork-1", cwd, fromEntryId: "user-1" })
    assert.ok(sent.some(event => event.t === "session_operation_result" && event.requestId === "fork-1" && !event.ok && event.message.includes("取消")))
    assert.equal(sent.filter(event => event.t === "session_created").length, 1)

    await compact(ctx, { t: "compact", requestId: "compact-1", cwd })
    assert.ok(sent.some(event => event.t === "session_operation_result" && event.requestId === "compact-1" && !event.ok && event.message === "Nothing to compact"))
  } finally {
    liveSessions.dispose(cwd)
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousAgent
    if (previousSessions === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessions
    if (previousEntry === undefined) delete process.env.PI_UI_PI_ENTRY
    else process.env.PI_UI_PI_ENTRY = previousEntry
    rmSync(root, { recursive: true, force: true })
  }
})
