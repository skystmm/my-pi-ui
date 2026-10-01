import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { mutateMemory, resolveMemorySuggestion } from "../src/commands/memory.js"
import { observePreference } from "../src/memory/suggestions.js"
import { pidForCwd, registerPidCwd } from "../src/project-scanner.js"
import { setOpenSession } from "../src/ws-util.js"
import { rememberOpenedProject } from "../src/opened-projects.js"
import type { Ctx } from "../src/commands/context.js"
import type { ShellEvent } from "../src/ws-protocol.js"

test("memory writes require a known project and the open session for session scope", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-memory-commands-"))
  const project = join(root, "project")
  const other = join(root, "other")
  const priorAgent = process.env.PI_CODING_AGENT_DIR
  const priorSessions = process.env.PI_CODING_AGENT_SESSION_DIR
  process.env.PI_CODING_AGENT_DIR = root
  process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions")
  mkdirSync(project)
  mkdirSync(other)
  const canonicalProject = realpathSync(project)
  mkdirSync(join(root, "sessions", pidForCwd(canonicalProject)), { recursive: true })
  registerPidCwd(pidForCwd(canonicalProject), canonicalProject)
  await rememberOpenedProject(project)
  const sent: ShellEvent[] = []
  const ws = {} as Ctx["ws"]
  const ctx = {
    ws,
    send: (event: ShellEvent) => sent.push(event),
    cwdOrError: async (cwd: string) => realpathSync(cwd),
  } as Ctx
  try {
    await mutateMemory(ctx, { t: "memory_create", requestId: "unknown", scope: "project", cwd: other, content: "no" })
    assert.equal((sent.at(-1) as Extract<ShellEvent, { t: "memory_result" }>).ok, false)
    await mutateMemory(ctx, { t: "memory_create", requestId: "wrong-session", scope: "session", cwd: project, sessionId: "s2", content: "no" })
    assert.equal((sent.at(-1) as Extract<ShellEvent, { t: "memory_result" }>).ok, false)
    setOpenSession(ws, pidForCwd(canonicalProject), "s1", canonicalProject)
    await mutateMemory(ctx, { t: "memory_create", requestId: "valid", scope: "session", cwd: project, sessionId: "s1", content: "yes" })
    assert.ok(sent.some(event => event.t === "memory_result" && event.requestId === "valid" && event.ok), JSON.stringify(sent))
    const suggestion = await observePreference("以后所有项目都先给结论", canonicalProject, "s1")
    assert.ok(suggestion)
    await resolveMemorySuggestion(ctx, { t: "memory_resolve_suggestion", requestId: "accept", cwd: project, id: suggestion.id, action: "accept", scope: "app", content: "以后先给结论" })
    assert.ok(sent.some(event => event.t === "memory_result" && event.requestId === "accept" && event.ok))
    assert.ok(sent.some(event => event.t === "memory_snapshot" && event.memories.some(m => m.content === "以后先给结论" && m.scope.kind === "app")))
  } finally {
    if (priorAgent === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = priorAgent
    if (priorSessions === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = priorSessions
    rmSync(root, { recursive: true, force: true })
  }
})
