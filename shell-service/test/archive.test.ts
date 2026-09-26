import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { archiveProject, archiveSession, openProject, projectsSnapshot, sessionsWithPending } from "../src/commands/session.js"
import { pidForCwd } from "../src/project-scanner.js"
import type { Ctx } from "../src/commands/context.js"
import type { ShellEvent } from "../src/ws-protocol.js"

test("project and session archive persists without changing Pi JSONL files", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ui-archive-"))
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR
  const previousSessionsDir = process.env.PI_CODING_AGENT_SESSION_DIR
  const events: ShellEvent[] = []
  const errors: string[] = []
  const ctx = {
    broadcast: (event: ShellEvent) => events.push(event),
    send: (event: ShellEvent) => events.push(event),
    fail: (code: string) => errors.push(code),
    cwdOrError: async (cwd: string) => cwd,
  } as Ctx
  try {
    process.env.PI_CODING_AGENT_DIR = root
    delete process.env.PI_CODING_AGENT_SESSION_DIR
    const cwd = join(root, "project")
    const pid = pidForCwd(cwd)
    mkdirSync(join(root, "sessions", pid), { recursive: true })
    mkdirSync(cwd)
    const file = join(root, "sessions", pid, "2026_one.jsonl")
    const jsonl = `${JSON.stringify({ type: "session", id: "one", cwd })}\n`
    writeFileSync(file, jsonl)

    assert.equal(projectsSnapshot().find(p => p.id === pid)?.archived, false)
    assert.equal((await sessionsWithPending(pid))[0]?.archived, false)
    await archiveSession(ctx, { t: "set_session_archived", projectId: pid, sessionId: "one", archived: true })
    assert.equal((await sessionsWithPending(pid))[0]?.archived, true)
    await archiveProject(ctx, { t: "set_project_archived", projectId: pid, archived: true })
    assert.equal(projectsSnapshot().find(p => p.id === pid)?.archived, true)
    await openProject(ctx, { t: "open_project", cwd })
    assert.equal(projectsSnapshot().find(p => p.id === pid)?.archived, false)
    assert.ok(events.some(e => e.t === "project_opened" && e.projectId === pid))
    assert.equal(readFileSync(file, "utf8"), jsonl)
    assert.ok(readFileSync(join(root, "pi-ui-archive.json"), "utf8").includes("one"))

    await archiveProject(ctx, { t: "set_project_archived", projectId: pid, archived: false })
    assert.equal(projectsSnapshot().find(p => p.id === pid)?.archived, false)
    assert.equal((await sessionsWithPending(pid))[0]?.archived, true)
    await archiveSession(ctx, { t: "set_session_archived", projectId: pid, sessionId: "one", archived: false })
    assert.equal((await sessionsWithPending(pid))[0]?.archived, false)
    assert.equal(readFileSync(file, "utf8"), jsonl)
    assert.equal(events.length, 7)

    await archiveProject(ctx, { t: "set_project_archived", projectId: "missing", archived: true })
    await archiveSession(ctx, { t: "set_session_archived", projectId: pid, sessionId: "missing", archived: true })
    assert.deepEqual(errors, ["project_not_found", "session_not_found"])
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir
    if (previousSessionsDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionsDir
    rmSync(root, { recursive: true, force: true })
  }
})
